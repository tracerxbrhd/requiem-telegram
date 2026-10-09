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

export function buildLegacyAutoReply(settings) {
  const lines = [
    '<b>⚠️ REQUIEM // АВТОМАТИЧЕСКОЕ СООБЩЕНИЕ</b>',
    '',
    'Если вы получили это сообщение, владелец данного профиля <b>предположительно мёртв</b>.',
    '',
  ];

  if (settings?.newAccount) {
    const username = settings.newAccount.replace(/^@/, '');
    lines.push(
      `<b>Новый аккаунт:</b> <a href="https://t.me/${escapeHtml(username)}">${escapeHtml(settings.newAccount)}</a>`,
    );
  } else {
    lines.push(
      '<b>Новый аккаунт:</b> не указан',
      'Пользователь не успел настроить это поле до активации Requiem.',
    );
  }

  lines.push(
    '',
    '<i>Сообщение отправлено автоматически системой Requiem. Оно не является подтверждением факта смерти.</i>',
    '<b>Система:</b> <a href="https://t.me/uwdrequiembot">@uwdrequiembot</a>',
  );

  return lines.join('\n');
}

function reminderLeadMs(days) {
  return REMINDER_LEAD_MS[normalizeHeartbeatDays(days)] ?? REMINDER_LEAD_MS[7];
}

function buildReminderText(settings, at = now()) {
  const remaining = getRemainingMs(settings, at);
  const interval = normalizeHeartbeatDays(settings.heartbeatDays);

  if (remaining <= 0) {
    return [
      '<b>⚠️ REQUIEM // СТАТУС ИСТЁК</b>',
      '',
      `Dead-man режим активирован: прошло больше <b>${interval} дн.</b> с последнего подтверждения.`,
      'При следующем входящем сообщении в управляемом чате Requiem сможет отправить автоматический ответ от вашего имени.',
      '',
      'Если вы на связи — подтвердите статус.',
    ].join('\n');
  }

  return [
    '<b>⏳ REQUIEM // ПРОДЛЕНИЕ СТАТУСА</b>',
    '',
    `До активации dead-man режима осталось примерно <b>${formatDuration(remaining)}</b>.`,
    `Текущий интервал: <b>${interval} дн.</b>`,
    '',
    'Подтвердите, что вы на связи, чтобы отсчёт начался заново.',
  ].join('\n');
}

export async function maybeSendHeartbeatReminder(settings, at = now()) {
  if (!settings || settings.activationMode !== LegacyMode.DEADMAN) return false;
  if (!settings.ownerChatId || settings.reminderSentAt) return false;

  const remaining = getRemainingMs(settings, at);
  if (remaining > reminderLeadMs(settings.heartbeatDays)) return false;

  const message = await api.sendMessage({
    chat_id: settings.ownerChatId,
    text: buildReminderText(settings, at),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        {
          text: `❤️ Я жив — продлить на ${normalizeHeartbeatDays(settings.heartbeatDays)} дн.`,
          callback_data: 'legacy:renew_reminder',
          style: 'success',
        },
      ]],
    },
  });

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
