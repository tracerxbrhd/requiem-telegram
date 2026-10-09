import { api, db } from 'sdk';
import { and, eq } from 'sdk/db';
import { todoViews } from '../schema.js';
import { listTodos } from './todos.js';
import {
  ensureLegacySettings,
  formatDuration,
  getLegacyExpiry,
  getOwnerBusinessConnection,
  getRemainingMs,
  isLegacyActive,
  LegacyMode,
} from './legacy.js';

const SECTION_HOME = 'home';
const SECTION_TODO = 'todo';
const SECTION_LEGACY = 'legacy';

const MODE_IDLE = 'idle';
const MODE_TODO_AWAIT_ADD = 'todo_await_add';
const MODE_TODO_COMPLETE = 'todo_complete';
const MODE_TODO_DELETE = 'todo_delete';
const MODE_LEGACY_AWAIT_ACCOUNT = 'legacy_await_account';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compactButtonText(value, max = 38) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatUtc(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '—';

  const two = (n) => String(n).padStart(2, '0');
  return [
    two(value.getUTCDate()),
    two(value.getUTCMonth() + 1),
    value.getUTCFullYear(),
  ].join('.') + ` · ${two(value.getUTCHours())}:${two(value.getUTCMinutes())} UTC`;
}

function splitTodos(rows) {
  return {
    active: rows.filter((todo) => !todo.done),
    completed: rows.filter((todo) => todo.done),
  };
}

function legacyModeLabel(settings) {
  return settings.activationMode === LegacyMode.MANUAL
    ? '🧪 Ручной'
    : '⏳ Автоконтроль';
}

function legacyStatePlain(settings) {
  if (settings.activationMode === LegacyMode.MANUAL) {
    return settings.manualActive
      ? '🔴 Автоответ активен'
      : '🟢 Автоответ выключен';
  }

  if (isLegacyActive(settings)) {
    return '🔴 Срок истёк — автоответ активен';
  }

  return `🟢 Статус подтверждён · осталось ~${formatDuration(getRemainingMs(settings))}`;
}

function legacyStateHtml(settings) {
  if (settings.activationMode === LegacyMode.MANUAL) {
    return settings.manualActive
      ? '🔴 <b>АВТООТВЕТ АКТИВЕН</b>'
      : '🟢 автоответ выключен';
  }

  if (isLegacyActive(settings)) {
    return '🔴 <b>СРОК ИСТЁК · АВТООТВЕТ АКТИВЕН</b>';
  }

  return `🟢 подтверждено · ещё <b>~${escapeHtml(formatDuration(getRemainingMs(settings)))}</b>`;
}

function connectionPlain(connection) {
  if (!connection) return '⚪ Не подключена';
  if (!connection.enabled) return '⚫ Подключение отключено';
  if (!connection.canReply) return '🟡 Нет разрешения на ответы';
  return '🟢 Подключена · ответы разрешены';
}

function connectionHtml(connection) {
  if (!connection) return '⚪ не подключена';
  if (!connection.enabled) return '⚫ подключение отключено';
  if (!connection.canReply) return '🟡 нет разрешения на ответы';
  return '🟢 <b>подключена</b> · ответы разрешены';
}

function accountHtml(settings) {
  if (!settings.newAccount) return '<code>не указан</code>';
  const username = settings.newAccount.replace(/^@/, '');
  return `<a href="https://t.me/${escapeHtml(username)}">${escapeHtml(settings.newAccount)}</a>`;
}

function richCallbackButton(text, data, style = null) {
  const styleAttr = style ? ` style="${style}"` : '';
  return `<tg-button type="callback_data"${styleAttr} data="${escapeHtml(data)}">${escapeHtml(text)}</tg-button>`;
}

function richButtonRow(buttons, align = 'center') {
  return `<tg-button-row align="${align}">${buttons.join('')}</tg-button-row>`;
}

function noticeBlock(notice) {
  return notice
    ? `<blockquote>ℹ️ ${escapeHtml(notice)}</blockquote>`
    : '';
}

function buildHomeRich(rows, settings, connection, notice) {
  const { active, completed } = splitTodos(rows);

  return {
    html: [
      '<h2>🕯 REQUIEM</h2>',
      '<p><mark>ЦЕНТР УПРАВЛЕНИЯ</mark></p>',
      '<hr/>',
      '<table bordered compact>',
      '<tr><th>РАЗДЕЛ</th><th>СОСТОЯНИЕ</th></tr>',
      `<tr><td>🕯 Наследие</td><td>${legacyStateHtml(settings)}</td></tr>`,
      `<tr><td>🔗 Связь с профилем</td><td>${connectionHtml(connection)}</td></tr>`,
      `<tr><td>📋 Задачи</td><td>🟡 <b>${active.length}</b> активных · ✅ <b>${completed.length}</b> выполнено</td></tr>`,
      '</table>',
      noticeBlock(notice),
      '<blockquote>Выберите раздел управления. Панель обновляется в этом же сообщении.</blockquote>',
      richButtonRow([
        richCallbackButton('📋 Задачи', 'panel:todo', 'primary'),
        richCallbackButton('🕯 Наследие', 'panel:legacy', 'primary'),
      ]),
      '<footer>Requiem · Telegram Serverless</footer>',
    ].filter(Boolean).join('\n'),
    skip_entity_detection: false,
  };
}

function homeFallback(rows, settings, connection, notice) {
  const { active, completed } = splitTodos(rows);
  const lines = [
    '<b>🕯 REQUIEM // ЦЕНТР УПРАВЛЕНИЯ</b>',
    '',
    `🕯 <b>Наследие:</b> ${legacyStateHtml(settings)}`,
    `🔗 <b>Связь с профилем:</b> ${connectionHtml(connection)}`,
    `📋 <b>Задачи:</b> 🟡 ${active.length} активных · ✅ ${completed.length} выполнено`,
  ];

  if (notice) lines.push('', `<i>ℹ️ ${escapeHtml(notice)}</i>`);
  return lines.join('\n');
}

function homeKeyboard() {
  return {
    inline_keyboard: [[
      { text: '📋 Задачи', callback_data: 'panel:todo', style: 'primary' },
      { text: '🕯 Наследие', callback_data: 'panel:legacy', style: 'primary' },
    ]],
  };
}

function buildTodoRich(rows, mode, notice) {
  const { active, completed } = splitTodos(rows);
  const parts = [
    '<h2>📋 REQUIEM // ЗАДАЧИ</h2>',
    `<p><mark>🟡 АКТИВНЫХ: ${active.length}</mark> · ✅ Выполнено: <b>${completed.length}</b></p>`,
    '<hr/>',
    '<h3>🟡 Активные задачи</h3>',
  ];

  if (active.length === 0) {
    parts.push('<blockquote>🎉 Активных задач нет.</blockquote>');
  } else {
    parts.push(
      '<table bordered compact>',
      '<tr><th>№</th><th>ЗАДАЧА</th></tr>',
      ...active.map((todo) => (
        `<tr><td><code>#${todo.id}</code></td><td>${escapeHtml(todo.text)}</td></tr>`
      )),
      '</table>',
    );
  }

  if (completed.length > 0) {
    parts.push(
      '<h3>✅ Выполненные</h3>',
      '<table compact>',
      '<tr><th>№</th><th>ЗАДАЧА</th></tr>',
      ...completed.map((todo) => (
        `<tr><td><code>#${todo.id}</code></td><td><s>${escapeHtml(todo.text)}</s></td></tr>`
      )),
      '</table>',
    );
  }

  if (rows.length >= 50) {
    parts.push('<footer>Показаны первые 50 задач.</footer>');
  }

  if (notice) parts.push(noticeBlock(notice));

  if (mode === MODE_TODO_AWAIT_ADD) {
    parts.push(
      '<blockquote>➕ <b>Добавление задачи</b><br>Отправьте текст задачи следующим сообщением.</blockquote>',
      richButtonRow([
        richCallbackButton('✖ Отмена', 'todo:cancel', 'link'),
        richCallbackButton('↩ Главная', 'panel:home', 'link'),
      ]),
    );
  } else if (mode === MODE_TODO_COMPLETE) {
    parts.push('<blockquote>✅ <b>Завершение</b><br>Выберите активную задачу.</blockquote>');

    if (active.length === 0) {
      parts.push(richButtonRow([
        '<tg-button type="disabled">🎉 Нет активных задач</tg-button>',
      ]));
    } else {
      for (const todo of active.slice(0, 20)) {
        parts.push(richButtonRow([
          richCallbackButton(
            `✅ #${todo.id} ${compactButtonText(todo.text)}`,
            `todo:done:${todo.id}`,
            'success',
          ),
        ]));
      }
    }

    parts.push(richButtonRow([
      richCallbackButton('↩ Назад', 'todo:cancel', 'link'),
    ]));
  } else if (mode === MODE_TODO_DELETE) {
    parts.push('<blockquote>🗑 <b>Удаление</b><br>Выберите задачу, которую нужно удалить безвозвратно.</blockquote>');

    if (rows.length === 0) {
      parts.push(richButtonRow([
        '<tg-button type="disabled">📭 Задач нет</tg-button>',
      ]));
    } else {
      for (const todo of rows.slice(0, 20)) {
        parts.push(richButtonRow([
          richCallbackButton(
            `🗑 #${todo.id} ${compactButtonText(todo.text)}`,
            `todo:del:${todo.id}`,
            'danger',
          ),
        ]));
      }
    }

    parts.push(richButtonRow([
      richCallbackButton('↩ Назад', 'todo:cancel', 'link'),
    ]));
  } else {
    parts.push(
      richButtonRow([
        richCallbackButton('➕ Добавить', 'todo:add', 'primary'),
        richCallbackButton('✅ Завершить', 'todo:complete', 'success'),
      ]),
      richButtonRow([
        richCallbackButton('🗑 Удалить', 'todo:delete', 'danger'),
        richCallbackButton('↩ Главная', 'panel:home', 'link'),
      ]),
    );
  }

  parts.push('<footer>📋 Requiem · список задач</footer>');

  return {
    html: parts.filter(Boolean).join('\n'),
    skip_entity_detection: false,
  };
}

function todoFallback(rows, mode, notice) {
  const { active, completed } = splitTodos(rows);
  const lines = [
    '<b>📋 REQUIEM // ЗАДАЧИ</b>',
    '',
    '<b>🟡 Активные</b>',
  ];

  if (active.length === 0) {
    lines.push('<i>🎉 Активных задач нет.</i>');
  } else {
    for (const todo of active) {
      lines.push(`☐ <b>#${todo.id}</b> ${escapeHtml(todo.text)}`);
    }
  }

  if (completed.length > 0) {
    lines.push('', '<b>✅ Выполненные</b>');
    for (const todo of completed) {
      lines.push(`✓ <s>#${todo.id} ${escapeHtml(todo.text)}</s>`);
    }
  }

  lines.push('', `🟡 Активных: <b>${active.length}</b> · ✅ Выполнено: <b>${completed.length}</b>`);

  if (notice) lines.push('', `<i>ℹ️ ${escapeHtml(notice)}</i>`);

  if (mode === MODE_TODO_AWAIT_ADD) {
    lines.push('', '➕ <b>Добавление задачи</b>', 'Отправьте текст задачи следующим сообщением.');
  } else if (mode === MODE_TODO_COMPLETE) {
    lines.push('', '✅ <b>Завершение</b>', 'Выберите активную задачу кнопкой ниже.');
  } else if (mode === MODE_TODO_DELETE) {
    lines.push('', '🗑 <b>Удаление</b>', 'Выберите задачу кнопкой ниже.');
  }

  return lines.join('\n');
}

function todoKeyboard(rows, mode) {
  if (mode === MODE_TODO_AWAIT_ADD) {
    return {
      inline_keyboard: [
        [{ text: '✖ Отмена', callback_data: 'todo:cancel' }],
        [{ text: '↩ Главная', callback_data: 'panel:home' }],
      ],
    };
  }

  if (mode === MODE_TODO_COMPLETE) {
    const active = rows.filter((todo) => !todo.done);
    const buttons = active.slice(0, 20).map((todo) => ([
      {
        text: `✅ #${todo.id} ${compactButtonText(todo.text)}`,
        callback_data: `todo:done:${todo.id}`,
        style: 'success',
      },
    ]));

    if (active.length === 0) {
      buttons.push([{ text: '🎉 Нет активных задач', callback_data: 'noop' }]);
    }

    buttons.push([{ text: '↩ Назад', callback_data: 'todo:cancel' }]);
    return { inline_keyboard: buttons };
  }

  if (mode === MODE_TODO_DELETE) {
    const buttons = rows.slice(0, 20).map((todo) => ([
      {
        text: `🗑 #${todo.id} ${compactButtonText(todo.text)}`,
        callback_data: `todo:del:${todo.id}`,
        style: 'danger',
      },
    ]));

    if (rows.length === 0) {
      buttons.push([{ text: '📭 Задач нет', callback_data: 'noop' }]);
    }

    buttons.push([{ text: '↩ Назад', callback_data: 'todo:cancel' }]);
    return { inline_keyboard: buttons };
  }

  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить', callback_data: 'todo:add', style: 'primary' },
        { text: '✅ Завершить', callback_data: 'todo:complete', style: 'success' },
      ],
      [
        { text: '🗑 Удалить', callback_data: 'todo:delete', style: 'danger' },
        { text: '↩ Главная', callback_data: 'panel:home' },
      ],
    ],
  };
}

function buildLegacyRich(settings, connection, mode, notice) {
  const parts = [
    '<h2>🕯 REQUIEM // НАСЛЕДИЕ</h2>',
    '<p><mark>🔐 АВТОМАТИЗАЦИЯ ПРОФИЛЯ</mark></p>',
    '<hr/>',
    '<table bordered compact>',
    '<tr><th>ПАРАМЕТР</th><th>ЗНАЧЕНИЕ</th></tr>',
    `<tr><td>⚙️ Режим</td><td><b>${escapeHtml(legacyModeLabel(settings))}</b></td></tr>`,
    `<tr><td>🚨 Автоответ</td><td>${legacyStateHtml(settings)}</td></tr>`,
    `<tr><td>🔗 Связь с профилем</td><td>${connectionHtml(connection)}</td></tr>`,
    `<tr><td>⏱ Период контроля</td><td><b>${settings.heartbeatDays} дн.</b></td></tr>`,
    `<tr><td>👤 Резервный аккаунт</td><td>${accountHtml(settings)}</td></tr>`,
  ];

  if (settings.activationMode === LegacyMode.DEADMAN) {
    parts.push(
      `<tr><td>❤️ Последнее подтверждение</td><td>${escapeHtml(formatUtc(settings.lastAliveAt))}</td></tr>`,
      `<tr><td>⌛ Активация после</td><td>${escapeHtml(formatUtc(getLegacyExpiry(settings)))}</td></tr>`,
    );
  }

  parts.push('</table>');

  if (notice) parts.push(noticeBlock(notice));

  if (mode === MODE_LEGACY_AWAIT_ACCOUNT) {
    parts.push(
      '<blockquote>👤 <b>Резервный аккаунт</b><br>Отправьте username следующим сообщением: <code>@username</code> или <code>t.me/username</code>.</blockquote>',
      richButtonRow([
        richCallbackButton('🧹 Очистить поле', 'legacy:account_clear', 'danger'),
        richCallbackButton('↩ Отмена', 'legacy:cancel', 'link'),
      ]),
    );
  } else {
    if (!connection) {
      parts.push('<blockquote>⚠️ Requiem ещё не подключён к вашему профилю. Откройте Telegram → Chat Automation, выберите бота и разрешите ответы.</blockquote>');
    } else if (!connection.canReply) {
      parts.push('<blockquote>⚠️ Подключение найдено, но Requiem не получил разрешение отвечать от имени профиля.</blockquote>');
    } else if (settings.activationMode === LegacyMode.DEADMAN && !isLegacyActive(settings)) {
      parts.push(`<blockquote>🫀 <b>Контроль активности включён.</b><br>До срабатывания протокола остаётся примерно <b>${escapeHtml(formatDuration(getRemainingMs(settings)))}</b>.</blockquote>`);
    } else if (settings.activationMode === LegacyMode.MANUAL && settings.manualActive) {
      parts.push('<blockquote>🧪 <b>Тестовый режим активен.</b><br>Следующее подходящее входящее сообщение может получить автоматический ответ Requiem.</blockquote>');
    }

    const modeText = settings.activationMode === LegacyMode.MANUAL
      ? '🔁 Режим: ручной'
      : '🔁 Режим: автоконтроль';

    const stateButton = settings.activationMode === LegacyMode.MANUAL
      ? richCallbackButton(
          settings.manualActive ? '⏹ Отключить автоответ' : '▶ Включить автоответ',
          'legacy:manual_toggle',
          settings.manualActive ? 'danger' : 'success',
        )
      : richCallbackButton(
          `❤️ Я на связи · +${settings.heartbeatDays} дн.`,
          'legacy:renew',
          'success',
        );

    parts.push(
      richButtonRow([
        richCallbackButton(modeText, 'legacy:mode', 'primary'),
      ]),
      richButtonRow([stateButton]),
      richButtonRow([
        richCallbackButton(
          `⏱ Период: ${settings.heartbeatDays} дн.`,
          'legacy:interval',
          'primary',
        ),
        richCallbackButton('👤 Резервный аккаунт', 'legacy:account', 'primary'),
      ]),
      richButtonRow([
        richCallbackButton('↩ Главная', 'panel:home', 'link'),
      ]),
    );
  }

  parts.push('<footer>🕯 Requiem · протокол наследия</footer>');

  return {
    html: parts.filter(Boolean).join('\n'),
    skip_entity_detection: false,
  };
}

function legacyFallback(settings, connection, mode, notice) {
  const lines = [
    '<b>🕯 REQUIEM // НАСЛЕДИЕ</b>',
    '',
    `⚙️ <b>Режим:</b> ${escapeHtml(legacyModeLabel(settings))}`,
    `🚨 <b>Автоответ:</b> ${legacyStateHtml(settings)}`,
    `🔗 <b>Связь с профилем:</b> ${connectionHtml(connection)}`,
    `⏱ <b>Период контроля:</b> ${settings.heartbeatDays} дн.`,
    `👤 <b>Резервный аккаунт:</b> ${accountHtml(settings)}`,
  ];

  if (settings.activationMode === LegacyMode.DEADMAN) {
    lines.push(
      `❤️ <b>Последнее подтверждение:</b> ${escapeHtml(formatUtc(settings.lastAliveAt))}`,
      `⌛ <b>Активация после:</b> ${escapeHtml(formatUtc(getLegacyExpiry(settings))}`,
    );
  }

  if (notice) lines.push('', `<i>ℹ️ ${escapeHtml(notice)}</i>`);

  if (mode === MODE_LEGACY_AWAIT_ACCOUNT) {
    lines.push('', '👤 <b>Резервный аккаунт</b>', 'Отправьте @username или t.me/username следующим сообщением.');
  }

  return lines.join('\n');
}

function legacyKeyboard(settings, mode) {
  if (mode === MODE_LEGACY_AWAIT_ACCOUNT) {
    return {
      inline_keyboard: [
        [
          { text: '🧹 Очистить поле', callback_data: 'legacy:account_clear', style: 'danger' },
        ],
        [{ text: '↩ Отмена', callback_data: 'legacy:cancel' }],
      ],
    };
  }

  const modeButton = {
    text: settings.activationMode === LegacyMode.MANUAL
      ? '🔁 Режим: ручной'
      : '🔁 Режим: автоконтроль',
    callback_data: 'legacy:mode',
    style: 'primary',
  };

  const stateButton = settings.activationMode === LegacyMode.MANUAL
    ? {
        text: settings.manualActive ? '⏹ Отключить автоответ' : '▶ Включить автоответ',
        callback_data: 'legacy:manual_toggle',
        style: settings.manualActive ? 'danger' : 'success',
      }
    : {
        text: `❤️ Я на связи · +${settings.heartbeatDays} дн.`,
        callback_data: 'legacy:renew',
        style: 'success',
      };

  return {
    inline_keyboard: [
      [modeButton],
      [stateButton],
      [
        {
          text: `⏱ Период: ${settings.heartbeatDays} дн.`,
          callback_data: 'legacy:interval',
          style: 'primary',
        },
        {
          text: '👤 Резервный аккаунт',
          callback_data: 'legacy:account',
          style: 'primary',
        },
      ],
      [{ text: '↩ Главная', callback_data: 'panel:home' }],
    ],
  };
}

function buildPanel(section, rows, settings, connection, mode, notice) {
  if (section === SECTION_TODO) {
    return {
      richMessage: buildTodoRich(rows, mode, notice),
      fallbackText: todoFallback(rows, mode, notice),
      fallbackMarkup: todoKeyboard(rows, mode),
    };
  }

  if (section === SECTION_LEGACY) {
    return {
      richMessage: buildLegacyRich(settings, connection, mode, notice),
      fallbackText: legacyFallback(settings, connection, mode, notice),
      fallbackMarkup: legacyKeyboard(settings, mode),
    };
  }

  return {
    richMessage: buildHomeRich(rows, settings, connection, notice),
    fallbackText: homeFallback(rows, settings, connection, notice),
    fallbackMarkup: homeKeyboard(),
  };
}

export async function getDashboardView(userId, chatId) {
  return await db.select().from(todoViews)
    .where(and(eq(todoViews.userId, userId), eq(todoViews.chatId, chatId)))
    .get();
}

async function saveDashboardView({
  userId,
  chatId,
  messageId,
  section,
  mode,
}) {
  const existing = await getDashboardView(userId, chatId);

  if (existing) {
    await db.update(todoViews)
      .set({
        messageId,
        section,
        mode,
        updatedAt: new Date(),
      })
      .where(eq(todoViews.id, existing.id))
      .run();
    return;
  }

  await db.insert(todoViews).values({
    userId,
    chatId,
    messageId,
    section,
    mode,
  }).run();
}

function isMessageNotModified(error) {
  return error?.code === 400
    && /message is not modified/i.test(error?.description ?? '');
}

function isStaleDashboard(error) {
  if (error?.code !== 400) return false;

  const description = String(error?.description ?? '');
  return /message to edit not found|message can't be edited|message_id_invalid|message identifier is not specified/i.test(description);
}

async function editDashboardMessage(chatId, messageId, panel) {
  try {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      rich_message: panel.richMessage,
      reply_markup: { inline_keyboard: [] },
    });
    return true;
  } catch (error) {
    if (isMessageNotModified(error)) return true;
    if (isStaleDashboard(error)) return false;

    console.warn('Rich dashboard edit unavailable; using HTML fallback', {
      chatId,
      messageId,
      code: error?.code,
      description: error?.description,
      message: error?.message,
    });
  }

  try {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: panel.fallbackText,
      parse_mode: 'HTML',
      reply_markup: panel.fallbackMarkup,
      link_preview_options: { is_disabled: true },
    });
    return true;
  } catch (error) {
    if (isMessageNotModified(error)) return true;
    if (isStaleDashboard(error)) return false;
    throw error;
  }
}

async function sendDashboardMessage(chatId, panel) {
  try {
    return await api.sendRichMessage({
      chat_id: chatId,
      rich_message: panel.richMessage,
    });
  } catch (error) {
    console.warn('Rich dashboard send unavailable; using HTML fallback', {
      chatId,
      code: error?.code,
      description: error?.description,
      message: error?.message,
    });

    return await api.sendMessage({
      chat_id: chatId,
      text: panel.fallbackText,
      parse_mode: 'HTML',
      reply_markup: panel.fallbackMarkup,
      link_preview_options: { is_disabled: true },
    });
  }
}

export async function showDashboard({
  userId,
  chatId,
  targetMessageId = null,
  section = null,
  mode = null,
  notice = null,
}) {
  const existing = await getDashboardView(userId, chatId);
  const resolvedSection = section ?? existing?.section ?? SECTION_HOME;
  const resolvedMode = mode ?? MODE_IDLE;

  const settings = await ensureLegacySettings(userId, chatId);
  const connection = await getOwnerBusinessConnection(userId);
  const rows = await listTodos(userId, { includeDone: true, limit: 50 });
  const panel = buildPanel(
    resolvedSection,
    rows,
    settings,
    connection,
    resolvedMode,
    notice,
  );

  let messageId = targetMessageId ?? existing?.messageId ?? null;

  if (messageId) {
    const edited = await editDashboardMessage(chatId, messageId, panel);
    if (!edited) messageId = null;
  }

  if (!messageId) {
    const message = await sendDashboardMessage(chatId, panel);
    messageId = message.message_id;
  }

  await saveDashboardView({
    userId,
    chatId,
    messageId,
    section: resolvedSection,
    mode: resolvedMode,
  });

  return {
    messageId,
    section: resolvedSection,
    mode: resolvedMode,
    rows,
    settings,
    connection,
  };
}

export async function safeDeleteMessage(chatId, messageId) {
  if (!chatId || !messageId) return;

  try {
    await api.deleteMessage({
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    if (error?.code !== 400 && error?.code !== 403) {
      console.warn('Could not delete message', {
        chatId,
        messageId,
        code: error?.code,
        description: error?.description,
      });
    }
  }
}

export const DashboardSection = {
  HOME: SECTION_HOME,
  TODO: SECTION_TODO,
  LEGACY: SECTION_LEGACY,
};

export const DashboardMode = {
  IDLE: MODE_IDLE,
  TODO_AWAIT_ADD: MODE_TODO_AWAIT_ADD,
  TODO_COMPLETE: MODE_TODO_COMPLETE,
  TODO_DELETE: MODE_TODO_DELETE,
  LEGACY_AWAIT_ACCOUNT: MODE_LEGACY_AWAIT_ACCOUNT,
};
