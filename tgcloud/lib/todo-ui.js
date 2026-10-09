import { api, db } from 'sdk';
import { and, eq } from 'sdk/db';
import { todoViews } from '../schema.js';
import { listTodos } from './todos.js';

const MODE_IDLE = 'idle';
const MODE_AWAIT_ADD = 'await_add';
const MODE_DELETE = 'delete';

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

function formatDashboard(rows, mode, notice) {
  const active = rows.filter((todo) => !todo.done);
  const completed = rows.filter((todo) => todo.done);
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

  if (mode === MODE_AWAIT_ADD) {
    lines.push('', '➕ <b>Новая задача</b>', 'Отправь текст задачи следующим сообщением.');
  } else if (mode === MODE_DELETE) {
    lines.push('', '🗑 <b>Удаление</b>', 'Выбери задачу кнопкой ниже.');
  }

  return lines.join('\n');
}

function buildKeyboard(rows, mode) {
  if (mode === MODE_AWAIT_ADD) {
    return {
      inline_keyboard: [[
        { text: '✖ Отмена', callback_data: 'todo:cancel' },
      ]],
    };
  }

  if (mode === MODE_DELETE) {
    const taskButtons = rows.slice(0, 20).map((todo) => ([
      {
        text: `🗑 #${todo.id} ${compactButtonText(todo.text)}`,
        callback_data: `todo:del:${todo.id}`,
      },
    ]));

    taskButtons.push([
      { text: '↩ Назад', callback_data: 'todo:cancel' },
    ]);

    return { inline_keyboard: taskButtons };
  }

  return {
    inline_keyboard: [[
      { text: '➕ Добавить задачу', callback_data: 'todo:add' },
      { text: '🗑 Удалить задачу', callback_data: 'todo:delete' },
    ]],
  };
}

export async function getTodoView(userId, chatId) {
  return await db.select().from(todoViews)
    .where(and(eq(todoViews.userId, userId), eq(todoViews.chatId, chatId)))
    .get();
}

async function saveTodoView({ userId, chatId, messageId, mode }) {
  const existing = await getTodoView(userId, chatId);

  if (existing) {
    await db.update(todoViews)
      .set({
        messageId,
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
    mode,
  }).run();
}

function isMessageNotModified(error) {
  return error?.code === 400
    && /message is not modified/i.test(error?.description ?? '');
}

function isStaleDashboard(error) {
  if (error?.code !== 400) return false;
  const description = error?.description ?? '';
  return /message to edit not found|message can't be edited/i.test(description);
}

export async function showTodoDashboard({
  userId,
  chatId,
  targetMessageId = null,
  mode = null,
  notice = null,
}) {
  const existing = await getTodoView(userId, chatId);
  const resolvedMode = mode ?? existing?.mode ?? MODE_IDLE;
  const rows = await listTodos(userId, { includeDone: true, limit: 50 });
  const text = formatDashboard(rows, resolvedMode, notice);
  const replyMarkup = buildKeyboard(rows, resolvedMode);
  let messageId = targetMessageId ?? existing?.messageId ?? null;

  if (messageId) {
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      });
    } catch (error) {
      if (!isMessageNotModified(error)) {
        if (!isStaleDashboard(error)) throw error;
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
    });
    messageId = message.message_id;
  }

  await saveTodoView({
    userId,
    chatId,
    messageId,
    mode: resolvedMode,
  });

  return { messageId, mode: resolvedMode, rows };
}

export async function safeDeleteMessage(chatId, messageId) {
  if (!chatId || !messageId) return;

  try {
    await api.deleteMessage({
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    console.warn('Could not delete message', {
      chatId,
      messageId,
      code: error?.code,
      description: error?.description,
    });
  }
}

export const TodoViewMode = {
  IDLE: MODE_IDLE,
  AWAIT_ADD: MODE_AWAIT_ADD,
  DELETE: MODE_DELETE,
};
