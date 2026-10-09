import { api, db } from 'sdk';
import { and, asc, desc, eq } from 'sdk/db';
import {
  businessConnections,
  legacyNotifications,
  legacySettings,
} from '../schema.js';

export const LegacyMode = {
  MANUAL: 'manual',
  DEADMAN: 'deadman',
};

export const HEARTBEAT_DAYS = [1, 7, 30];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REMINDER_LEAD_MS = {
  1: 4 * HOUR_MS,
  7: 24 * HOUR_MS,
  30: 72 * HOUR_MS,
};

function now() {
  return new Date();
}

function normalizeMode(mode) {
  return mode === LegacyMode.DEADMAN ? LegacyMode.DEADMAN : LegacyMode.MANUAL;
}

function normalizeHeartbeatDays(days) {
  return HEARTBEAT_DAYS.includes(days) ? days : 7;
}

export function normalizeNewAccount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  if (['-', 'нет', 'none', 'null', 'clear', 'очистить'].includes(lowered)) {
    return null;
  }

  const match = raw.match(/^(?:https?:\/\/)?(?:t\.me\/)?@?([A-Za-z0-9_]{5,32})\/?$/i);
  if (!match) throw new Error('NEW_ACCOUNT_INVALID');

  return `@${match[1]}`;
}

export function getLegacyExpiry(settings) {
  const days = normalizeHeartbeatDays(settings?.heartbeatDays);
  const base = settings?.lastAliveAt instanceof Date
    ? settings.lastAliveAt.getTime()
    : new Date(settings?.lastAliveAt ?? 0).getTime();

  return new Date(base + days * DAY_MS);
}

export function isLegacyActive(settings, at = now()) {
  if (!settings) return false;

  if (normalizeMode(settings.activationMode) === LegacyMode.MANUAL) {
    return Boolean(settings.manualActive);
  }

  return at.getTime() >= getLegacyExpiry(settings).getTime();
}

export function getRemainingMs(settings, at = now()) {
  return getLegacyExpiry(settings).getTime() - at.getTime();
}

export function formatDuration(ms) {
  const absolute = Math.abs(ms);
  const days = Math.floor(absolute / DAY_MS);
  const hours = Math.floor((absolute % DAY_MS) / HOUR_MS);

  if (days > 0) return `${days} дн. ${hours} ч.`;

  const minutes = Math.max(1, Math.ceil(absolute / (60 * 1000)));
  if (hours > 0) return `${hours} ч. ${minutes % 60} мин.`;
  return `${minutes} мин.`;
}

export async function getLegacySettings(ownerUserId) {
  return await db.select().from(legacySettings)
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .get();
}

export async function ensureLegacySettings(ownerUserId, ownerChatId = null) {
  let settings = await getLegacySettings(ownerUserId);

  if (!settings) {
    const rows = await db.insert(legacySettings).values({
      ownerUserId,
      ownerChatId,
      activationMode: LegacyMode.MANUAL,
      manualActive: false,
      heartbeatDays: 7,
      lastAliveAt: now(),
    }).returning();
    settings = rows[0] ?? null;
  } else if (ownerChatId && settings.ownerChatId !== ownerChatId) {
    const rows = await db.update(legacySettings)
      .set({ ownerChatId, updatedAt: now() })
      .where(eq(legacySettings.id, settings.id))
      .returning();
    settings = rows[0] ?? settings;
  }

  return settings;
}

export async function clearLegacyNotifications(ownerUserId) {
  await db.delete(legacyNotifications)
    .where(eq(legacyNotifications.ownerUserId, ownerUserId))
    .run();
}

async function deleteReminderMessage(settings) {
  if (!settings?.ownerChatId || !settings?.reminderMessageId) return;

  try {
    await api.deleteMessage({
      chat_id: settings.ownerChatId,
      message_id: settings.reminderMessageId,
    });
  } catch (error) {
    console.warn('Could not delete heartbeat reminder', {
      ownerUserId: settings.ownerUserId,
      code: error?.code,
      description: error?.description,
      message: error?.message,
    });
  }
}

export async function renewLegacyStatus(ownerUserId, ownerChatId = null) {
  const settings = await ensureLegacySettings(ownerUserId, ownerChatId);
  await deleteReminderMessage(settings);

  const rows = await db.update(legacySettings)
    .set({
      lastAliveAt: now(),
      reminderSentAt: null,
      reminderMessageId: null,
      updatedAt: now(),
    })
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .returning();

  await clearLegacyNotifications(ownerUserId);
  return rows[0] ?? settings;
}

export async function setLegacyMode(ownerUserId, mode, ownerChatId = null) {
  const settings = await ensureLegacySettings(ownerUserId, ownerChatId);
  const nextMode = normalizeMode(mode);

  await deleteReminderMessage(settings);

  const patch = {
    activationMode: nextMode,
    manualActive: false,
    reminderSentAt: null,
    reminderMessageId: null,
    updatedAt: now(),
  };

  if (nextMode === LegacyMode.DEADMAN) {
    patch.lastAliveAt = now();
  }

  const rows = await db.update(legacySettings)
    .set(patch)
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .returning();

  await clearLegacyNotifications(ownerUserId);
  return rows[0] ?? settings;
}

export async function toggleManualLegacy(ownerUserId, ownerChatId = null) {
  const settings = await ensureLegacySettings(ownerUserId, ownerChatId);
  const nextActive = !settings.manualActive;

  const rows = await db.update(legacySettings)
    .set({
      activationMode: LegacyMode.MANUAL,
      manualActive: nextActive,
      updatedAt: now(),
    })
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .returning();

  if (nextActive) {
    await clearLegacyNotifications(ownerUserId);
  }

  return rows[0] ?? settings;
}

export async function cycleHeartbeat(ownerUserId, ownerChatId = null) {
  const settings = await ensureLegacySettings(ownerUserId, ownerChatId);
  const current = normalizeHeartbeatDays(settings.heartbeatDays);
  const index = HEARTBEAT_DAYS.indexOf(current);
  const nextDays = HEARTBEAT_DAYS[(index + 1) % HEARTBEAT_DAYS.length];

  await deleteReminderMessage(settings);

  const rows = await db.update(legacySettings)
    .set({
      heartbeatDays: nextDays,
      lastAliveAt: settings.activationMode === LegacyMode.DEADMAN ? now() : settings.lastAliveAt,
      reminderSentAt: null,
      reminderMessageId: null,
      updatedAt: now(),
    })
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .returning();

  if (settings.activationMode === LegacyMode.DEADMAN) {
    await clearLegacyNotifications(ownerUserId);
  }

  return rows[0] ?? settings;
}

export async function setNewAccount(ownerUserId, value, ownerChatId = null) {
  const settings = await ensureLegacySettings(ownerUserId, ownerChatId);
  const newAccount = normalizeNewAccount(value);

  const rows = await db.update(legacySettings)
    .set({
      newAccount,
      updatedAt: now(),
    })
    .where(eq(legacySettings.ownerUserId, ownerUserId))
    .returning();

  return rows[0] ?? settings;
}

export async function upsertBusinessConnection(connection) {
  if (!connection?.id || !connection?.user?.id || !connection?.user_chat_id) {
    throw new Error('BUSINESS_CONNECTION_INVALID');
  }

  const existing = await db.select().from(businessConnections)
    .where(eq(businessConnections.connectionId, connection.id))
    .get();

  const values = {
    connectionId: connection.id,
    ownerUserId: connection.user.id,
    userChatId: connection.user_chat_id,
    enabled: Boolean(connection.is_enabled),
    canReply: Boolean(connection.rights?.can_reply),
    updatedAt: now(),
  };

  let row;
  if (existing) {
    const rows = await db.update(businessConnections)
      .set(values)
      .where(eq(businessConnections.id, existing.id))
      .returning();
    row = rows[0] ?? existing;
  } else {
    const rows = await db.insert(businessConnections)
      .values(values)
      .returning();
    row = rows[0] ?? null;
  }

  await ensureLegacySettings(connection.user.id, connection.user_chat_id);
  return row;
}

export async function getBusinessConnection(connectionId) {
  return await db.select().from(businessConnections)
    .where(eq(businessConnections.connectionId, connectionId))
    .get();
}

export async function ensureBusinessConnection(connectionId) {
  let connection = await getBusinessConnection(connectionId);
  if (connection) return connection;

  const remote = await api.getBusinessConnection({
    business_connection_id: connectionId,
  });

  return await upsertBusinessConnection(remote);
}

export async function getOwnerBusinessConnection(ownerUserId) {
  return await db.select().from(businessConnections)
    .where(eq(businessConnections.ownerUserId, ownerUserId))
    .orderBy(desc(businessConnections.updatedAt))
    .get();
}

export async function hasLegacyNotification(ownerUserId, chatId) {
  return Boolean(await db.select().from(legacyNotifications)
    .where(and(
      eq(legacyNotifications.ownerUserId, ownerUserId),
      eq(legacyNotifications.chatId, chatId),
    ))
    .get());
}

export async function recordLegacyNotification(ownerUserId, connectionId, chatId) {
  const existing = await hasLegacyNotification(ownerUserId, chatId);
  if (existing) return;

  await db.insert(legacyNotifications).values({
    ownerUserId,
    connectionId,
    chatId,
  }).run();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function legacyHeartbeatDiagnostic(settings, at = now()) {
  if (settings?.activationMode !== LegacyMode.DEADMAN) {
    return {
      code: 'РУЧНАЯ АКТИВАЦИЯ',
      detail: 'Протокол наследия активирован вручную в тестовом режиме.',
    };
  }

  const lastAliveAt = settings?.lastAliveAt instanceof Date
    ? settings.lastAliveAt
    : new Date(settings?.lastAliveAt ?? 0);
  const elapsedMs = Math.max(0, at.getTime() - lastAliveAt.getTime());

  return {
    code: elapsedMs >= DAY_MS
      ? 'НЕТ СИГНАЛА ≥24 Ч'
      : 'СИГНАЛ НЕ ПОДТВЕРЖДЁН',
    detail: elapsedMs >= DAY_MS
      ? `Requiem не получал контрольного подтверждения жизненного статуса пользователя ${formatDuration(elapsedMs)}.`
      : 'Контрольное подтверждение жизненного статуса пользователя отсутствует.',
  };
}

function legacyAccountHtml(settings) {
  if (!settings?.newAccount) {
    return {
      rich: '<code>НЕ НАСТРОЕН</code>',
      fallback: '<b>📡 Резервный аккаунт:</b> не указан\nПользователь не успел настроить это поле до активации Requiem.',
    };
  }

  const username = settings.newAccount.replace(/^@/, '');
  const linked = `<a href="https://t.me/${escapeHtml(username)}">${escapeHtml(settings.newAccount)}</a>`;

  return {
    rich: linked,
    fallback: `<b>📡 Резервный аккаунт:</b> ${linked}`,
  };
}

export function buildLegacyRichMessage(settings) {
  const heartbeat = legacyHeartbeatDiagnostic(settings);
  const account = legacyAccountHtml(settings);

  const heartbeatNarrative = settings?.activationMode === LegacyMode.DEADMAN
    ? `${heartbeat.detail} Порог автоматической проверки превышен — Requiem активировал протокол наследия.`
    : 'Протокол наследия был активирован заранее в ручном режиме. Это тестовая активация, а не результат истечения таймера.';

  const accountNote = settings?.newAccount
    ? '<p>📡 Для дальнейшей связи владелец оставил резервный Telegram-аккаунт.</p>'
    : '<p>📡 <b>Резервный аккаунт отсутствует.</b> Пользователь не успел настроить это поле до активации Requiem.</p>';

  return {
    html: [
      '<h2>⚠️ REQUIEM // ПРОТОКОЛ НАСЛЕДИЯ</h2>',
      '<p><mark>🤖 АВТОМАТИЧЕСКАЯ ПЕРЕДАЧА</mark> <code>НЕ ОТПРАВЛЕНО ВРУЧНУЮ</code></p>',
      '<hr/>',
      '<table bordered compact>',
      '<tr><th>КОНТУР</th><th>СТАТУС</th></tr>',
      `<tr><td>🫀 Монитор жизненного статуса</td><td><code>${escapeHtml(heartbeat.code)}</code></td></tr>`,
      '<tr><td>👤 Владелец профиля</td><td><code>ПРЕДПОЛОЖИТЕЛЬНО МЁРТВ</code></td></tr>',
      `<tr><td>📡 Резервный аккаунт</td><td>${account.rich}</td></tr>`,
      '<tr><td>🤖 Источник сообщения</td><td><a href="https://t.me/uwdrequiembot">@uwdrequiembot</a></td></tr>',
      '</table>',
      '<blockquote>',
      `${escapeHtml(heartbeatNarrative)}<br><br>`,
      'Если вы получили это сообщение, владелец данного профиля <b>предположительно мёртв</b>.',
      '<cite>Протокол наследия Requiem</cite>',
      '</blockquote>',
      accountNote,
      '<hr/>',
      '<footer>Сообщение сформировано автоматически системой @uwdrequiembot через Telegram Chat Automation. Владелец профиля не вводил и не отправлял его вручную. «Монитор жизненного статуса» Requiem основан на контрольных подтверждениях активности и не является медицинским устройством или подтверждением смерти.</footer>',
      '<tg-button-row align="left">',
      '<tg-button type="url" style="primary" url="https://t.me/uwdrequiembot">🤖 Открыть Requiem</tg-button>',
      '</tg-button-row>',
    ].join('\n'),
    skip_entity_detection: false,
  };
}

export function buildLegacyAutoReply(settings) {
  const heartbeat = legacyHeartbeatDiagnostic(settings);
  const account = legacyAccountHtml(settings);
  const lines = [
    '<b>⚠️ REQUIEM // ПРОТОКОЛ НАСЛЕДИЯ</b>',
    '<code>🤖 АВТОМАТИЧЕСКАЯ ПЕРЕДАЧА · НЕ ОТПРАВЛЕНО ВРУЧНУЮ</code>',
    '',
    `<b>🫀 Монитор жизненного статуса:</b> <code>${escapeHtml(heartbeat.code)}</code>`,
    '<b>👤 Владелец профиля:</b> <code>ПРЕДПОЛОЖИТЕЛЬНО МЁРТВ</code>',
    '',
    `<blockquote>${escapeHtml(heartbeat.detail)}\n\nЕсли вы получили это сообщение, владелец данного профиля <b>предположительно мёртв</b>.</blockquote>`,
    '',
    account.fallback,
    '',
    '<i>🤖 Сообщение сформировано автоматически @uwdrequiembot через Telegram Chat Automation. Владелец профиля не вводил и не отправлял его вручную. Контроль Requiem основан на подтверждениях активности и не является медицинским подтверждением смерти.</i>',
  ];

  return lines.join('\n');
}

export function legacyReplyMarkup() {
  return {
    inline_keyboard: [[
      {
        text: '🤖 Открыть Requiem',
        url: 'https://t.me/uwdrequiembot',
        style: 'primary',
      },
    ]],
  };
}

function reminderLeadMs(days) {
  return REMINDER_LEAD_MS[normalizeHeartbeatDays(days)] ?? REMINDER_LEAD_MS[7];
}

function buildReminderText(settings, at = now()) {
  const remaining = getRemainingMs(settings, at);
  const interval = normalizeHeartbeatDays(settings.heartbeatDays);

  if (remaining <= 0) {
    return [
      '<b>🚨 REQUIEM // СТАТУС ИСТЁК</b>',
      '',
      `🫀 Контрольное подтверждение не получено в течение <b>${interval} дн.</b>`,
      'Протокол наследия активирован. При следующем подходящем входящем сообщении Requiem сможет отправить автоматический ответ от вашего имени.',
      '',
      'Если вы на связи — подтвердите статус.',
    ].join('\n');
  }

  return [
    '<b>⏳ REQUIEM // ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ</b>',
    '',
    `🫀 До активации протокола осталось примерно <b>${formatDuration(remaining)}</b>.`,
    `⏱ Период контроля: <b>${interval} дн.</b>`,
    '',
    'Подтвердите, что вы на связи, чтобы отсчёт начался заново.',
  ].join('\n');
}

function buildReminderRichMessage(settings, at = now()) {
  const remaining = getRemainingMs(settings, at);
  const interval = normalizeHeartbeatDays(settings.heartbeatDays);
  const expired = remaining <= 0;

  return {
    html: [
      expired
        ? '<h2>🚨 REQUIEM // СТАТУС ИСТЁК</h2>'
        : '<h2>⏳ REQUIEM // ПОДТВЕРЖДЕНИЕ СТАТУСА</h2>',
      '<p><mark>🫀 КОНТРОЛЬ ЖИЗНЕННОГО СТАТУСА</mark></p>',
      '<hr/>',
      '<table bordered compact>',
      '<tr><th>ПАРАМЕТР</th><th>ЗНАЧЕНИЕ</th></tr>',
      `<tr><td>⏱ Период контроля</td><td><b>${interval} дн.</b></td></tr>`,
      expired
        ? '<tr><td>🚨 Состояние</td><td><code>СРОК ИСТЁК</code></td></tr>'
        : `<tr><td>⌛ Осталось</td><td><b>~${escapeHtml(formatDuration(remaining))}</b></td></tr>`,
      '</table>',
      expired
        ? '<blockquote>Контрольное подтверждение не получено вовремя. Протокол наследия активирован. Если вы на связи — подтвердите статус сейчас.</blockquote>'
        : '<blockquote>Requiem ожидает подтверждение активности. Нажмите кнопку ниже, чтобы начать новый период контроля.</blockquote>',
      '<tg-button-row align="center">',
      `<tg-button type="callback_data" style="success" data="legacy:renew_reminder">❤️ Я на связи · продлить на ${interval} дн.</tg-button>`,
      '</tg-button-row>',
      '<footer>🕯 Requiem · контроль активности</footer>',
    ].join('\n'),
    skip_entity_detection: false,
  };
}

function reminderReplyMarkup(settings) {
  return {
    inline_keyboard: [[
      {
        text: `❤️ Я на связи · продлить на ${normalizeHeartbeatDays(settings.heartbeatDays)} дн.`,
        callback_data: 'legacy:renew_reminder',
        style: 'success',
      },
    ]],
  };
}

export async function maybeSendHeartbeatReminder(settings, at = now()) {
  if (!settings || settings.activationMode !== LegacyMode.DEADMAN) return false;
  if (!settings.ownerChatId || settings.reminderSentAt) return false;

  const remaining = getRemainingMs(settings, at);
  if (remaining > reminderLeadMs(settings.heartbeatDays)) return false;

  let message;
  try {
    message = await api.sendRichMessage({
      chat_id: settings.ownerChatId,
      rich_message: buildReminderRichMessage(settings, at),
    });
  } catch (error) {
    console.warn('Rich heartbeat reminder unavailable; using HTML fallback', {
      ownerUserId: settings.ownerUserId,
      code: error?.code,
      description: error?.description,
      message: error?.message,
    });

    message = await api.sendMessage({
      chat_id: settings.ownerChatId,
      text: buildReminderText(settings, at),
      parse_mode: 'HTML',
      reply_markup: reminderReplyMarkup(settings),
    });
  }

  await db.update(legacySettings)
    .set({
      reminderSentAt: at,
      reminderMessageId: message.message_id,
      updatedAt: at,
    })
    .where(eq(legacySettings.ownerUserId, settings.ownerUserId))
    .run();

  return true;
}

export async function runHeartbeatReminderSweep() {
  const rows = await db.select().from(legacySettings)
    .where(eq(legacySettings.activationMode, LegacyMode.DEADMAN))
    .orderBy(asc(legacySettings.ownerUserId))
    .limit(500)
    .all();

  let sent = 0;
  let failed = 0;

  for (const settings of rows) {
    try {
      if (await maybeSendHeartbeatReminder(settings)) sent += 1;
    } catch (error) {
      failed += 1;
      console.error('Heartbeat reminder failed', {
        ownerUserId: settings.ownerUserId,
        code: error?.code,
        description: error?.description,
        message: error?.message,
      });
    }
  }

  return { checked: rows.length, sent, failed };
}
