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
    .replace(/>/g, '&gt;');
}

function compactButtonText(value, max = 42) {
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
  ].join('.') + ` ${two(value.getUTCHours())}:${two(value.getUTCMinutes())} UTC`;
}

function splitTodos(rows) {
  return {
    active: rows.filter((todo) => !todo.done),
    completed: rows.filter((todo) => todo.done),
  };
}

function legacyStateLabel(settings) {
  if (settings.activationMode === LegacyMode.MANUAL) {
    return settings.manualActive
      ? '🔴 автоответ <b>АКТИВЕН</b>'
      : '🟢 автоответ выключен';
  }

  if (isLegacyActive(settings)) {
    return '🔴 срок истёк — dead-man автоответ <b>АКТИВЕН</b>';
  }

  return `🟢 подтверждено ещё примерно <b>${formatDuration(getRemainingMs(settings))}</b>`;
}

function connectionLabel(connection) {
  if (!connection) return '⚪ не подключён';
  if (!connection.enabled) return '⚫ подключение отключено';
  if (!connection.canReply) return '🟡 подключён, но нет права <code>can_reply</code>';
  return '🟢 подключён, ответы разрешены';
}

function formatHome(rows, settings, connection, notice) {
  const { active, completed } = splitTodos(rows);
  const lines = [
    '<b>REQUIEM // DASHBOARD</b>',
    '',
    '<b>Legacy</b>',
    `Режим: <b>${settings.activationMode === LegacyMode.MANUAL ? 'ручной' : 'dead-man'}</b>`,
    `Статус: ${legacyStateLabel(settings)}`,
    `Chat Automation: ${connectionLabel(connection)}`,
    '',
    '<b>To-Do</b>',
    `Активных: <b>${active.length}</b> · Выполнено: <b>${completed.length}</b>`,
  ];

  if (notice) lines.push('', `<i>${escapeHtml(notice)}</i>`);
  return lines.join('\n');
}

function homeKeyboard() {
  return {
    inline_keyboard: [[
      {
        text: '📋 To-Do',
        callback_data: 'panel:todo',
        style: 'primary',
      },
      {
        text: '🕯 Legacy',
        callback_data: 'panel:legacy',
        style: 'primary',
      },
    ]],
  };
}

function formatTodo(rows, mode, notice) {
  const { active, completed } = splitTodos(rows);
  const lines = ['<b>REQUIEM // TODO</b>', ''];

  lines.push('<b>Активные</b>');
  if (active.length === 0) {
    lines.push('<i>Активных задач нет.</i>');
  } else {
    for (const todo of active) {
      lines.push(`☐ <b>#${todo.id}</b> ${escapeHtml(todo.text)}`);
    }
  }

  if (completed.length > 0) {
    lines.push('', '<b>Выполненные</b>');
    for (const todo of completed) {
      lines.push(`✓ <s>#${todo.id} ${escapeHtml(todo.text)}</s>`);
    }
  }

  lines.push('', `Активных: <b>${active.length}</b> · Выполнено: <b>${completed.length}</b>`);

  if (rows.length >= 50) {
    lines.push('<i>Показаны первые 50 задач.</i>');
  }

  if (notice) {
    lines.push('', `<i>${escapeHtml(notice)}</i>`);
  }

  if (mode === MODE_TODO_AWAIT_ADD) {
    lines.push('', '➕ <b>Новая задача</b>', 'Отправь текст задачи следующим сообщением.');
  } else if (mode === MODE_TODO_COMPLETE) {
    lines.push('', '✅ <b>Завершение</b>', 'Выбери активную задачу кнопкой ниже.');
  } else if (mode === MODE_TODO_DELETE) {
    lines.push('', '🗑 <b>Удаление</b>', 'Выбери задачу кнопкой ниже.');
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
      buttons.push([{ text: 'Нет активных задач', callback_data: 'noop' }]);
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
      buttons.push([{ text: 'Задач нет', callback_data: 'noop' }]);
    }

    buttons.push([{ text: '↩ Назад', callback_data: 'todo:cancel' }]);
    return { inline_keyboard: buttons };
  }

  return {
    inline_keyboard: [
      [
        {
          text: '➕ Добавить',
          callback_data: 'todo:add',
          style: 'primary',
        },
        {
          text: '✅ Завершить',
          callback_data: 'todo:complete',
          style: 'success',
        },
      ],
      [
        {
          text: '🗑 Удалить',
          callback_data: 'todo:delete',
          style: 'danger',
        },
        {
          text: '↩ Главная',
          callback_data: 'panel:home',
        },
      ],
    ],
  };
}

function formatLegacy(settings, connection, mode, notice) {
  const lines = [
    '<b>REQUIEM // LEGACY</b>',
    '',
    `Режим активации: <b>${settings.activationMode === LegacyMode.MANUAL ? 'ручной' : 'dead-man'}</b>`,
    `Статус: ${legacyStateLabel(settings)}`,
    `Chat Automation: ${connectionLabel(connection)}`,
    '',
    `Интервал проверки: <b>${settings.heartbeatDays} дн.</b>`,
  ];

  if (settings.activationMode === LegacyMode.DEADMAN) {
    lines.push(
      `Последнее подтверждение: <b>${formatUtc(settings.lastAliveAt)}</b>`,
      `Активация после: <b>${formatUtc(getLegacyExpiry(settings))}</b>`,
    );
  }

  lines.push(
    `Новый аккаунт: <b>${settings.newAccount ? escapeHtml(settings.newAccount) : 'не указан'}</b>`,
  );

  if (notice) lines.push('', `<i>${escapeHtml(notice)}</i>`);

  if (mode === MODE_LEGACY_AWAIT_ACCOUNT) {
    lines.push(
      '',
      '👤 <b>Новый аккаунт</b>',
      'Отправь username следующим сообщением: <code>@username</code> или <code>t.me/username</code>.',
    );
  } else if (!connection) {
    lines.push(
      '',
      '<i>Чтобы автоответ работал от имени профиля, подключи Requiem в Telegram → Chat Automation и выдай право отвечать.</i>',
    );
  } else if (!connection.canReply) {
    lines.push(
      '',
      '<i>Подключение найдено, но Telegram не дал Requiem право отвечать от имени профиля.</i>',
    );
  }

  return lines.join('\n');
}

function legacyKeyboard(settings, mode) {
  if (mode === MODE_LEGACY_AWAIT_ACCOUNT) {
    return {
      inline_keyboard: [
        [
          {
            text: '🧹 Очистить поле',
            callback_data: 'legacy:account_clear',
            style: 'danger',
          },
        ],
        [{ text: '↩ Отмена', callback_data: 'legacy:cancel' }],
      ],
    };
  }

  const modeButton = {
    text: settings.activationMode === LegacyMode.MANUAL
      ? '🔁 Режим: ручной'
      : '🔁 Режим: dead-man',
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
        text: `❤️ Я жив — +${settings.heartbeatDays} дн.`,
        callback_data: 'legacy:renew',
        style: 'success',
      };

  return {
    inline_keyboard: [
      [modeButton],
      [stateButton],
      [
        {
          text: `⏱ Интервал: ${settings.heartbeatDays} дн.`,
          callback_data: 'legacy:interval',
          style: 'primary',
        },
        {
          text: '👤 Новый аккаунт',
          callback_data: 'legacy:account',
          style: 'primary',
        },
      ],
      [{ text: '↩ Главная', callback_data: 'panel:home' }],
    ],
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

function shouldReplaceDashboard(error) {
  if (error?.code !== 400) return false;
  return !isMessageNotModified(error);
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

  let text;
  let replyMarkup;

  if (resolvedSection === SECTION_TODO) {
    text = formatTodo(rows, resolvedMode, notice);
    replyMarkup = todoKeyboard(rows, resolvedMode);
  } else if (resolvedSection === SECTION_LEGACY) {
    text = formatLegacy(settings, connection, resolvedMode, notice);
    replyMarkup = legacyKeyboard(settings, resolvedMode);
  } else {
    text = formatHome(rows, settings, connection, notice);
    replyMarkup = homeKeyboard();
  }

  let messageId = targetMessageId ?? existing?.messageId ?? null;

  if (messageId) {
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (!isMessageNotModified(error)) {
        if (!shouldReplaceDashboard(error)) throw error;
        messageId = null;
      }
    }
  }

  if (!messageId) {
    const message = await api.sendMessage({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      link_preview_options: { is_disabled: true },
    });
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
