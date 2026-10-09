import { addTodo, deleteTodo, markTodoDone } from '../lib/todos.js';
import {
  getTodoView,
  safeDeleteMessage,
  showTodoDashboard,
  TodoViewMode,
} from '../lib/todo-ui.js';

function parseCommand(text) {
  const trimmed = text.trim();
  const match = /^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;

  return {
    name: match[1].toLowerCase(),
    args: (match[2] ?? '').trim(),
  };
}

function parseId(value) {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function refreshDashboard(userId, chatId, options = {}) {
  return await showTodoDashboard({
    userId,
    chatId,
    ...options,
  });
}

async function addFromMessage(message, userId, chatId, text, source) {
  return await addTodo({
    userId,
    text,
    source,
    sourceChatId: chatId,
    sourceMessageId: message.message_id,
  });
}

export default async function (message, ctx) {
  if (!message?.chat?.id || !message?.from?.id || message.from.is_bot) return;
  if (typeof message.text !== 'string') return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const view = await getTodoView(userId, chatId);
  const command = parseCommand(message.text);

  if (!command) {
    if (view?.mode !== TodoViewMode.AWAIT_ADD) return;

    try {
      await addFromMessage(message, userId, chatId, message.text, 'dashboard');
      await refreshDashboard(userId, chatId, {
        targetMessageId: view.messageId,
        mode: TodoViewMode.IDLE,
      });
    } catch (error) {
      if (error?.message === 'TODO_TEXT_TOO_LONG') {
        await refreshDashboard(userId, chatId, {
          targetMessageId: view.messageId,
          mode: TodoViewMode.AWAIT_ADD,
          notice: 'Задача слишком длинная. Максимум 500 символов.',
        });
      } else {
        throw error;
      }
    } finally {
      await safeDeleteMessage(chatId, message.message_id);
    }
    return;
  }

  try {
    switch (command.name) {
      case 'start':
      case 'help':
        await refreshDashboard(userId, chatId, {
          mode: TodoViewMode.IDLE,
        });
        return;

      case 'todo':
        if (command.args && command.args.toLowerCase() !== 'all') {
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.IDLE,
            notice: 'Использование: /todo',
          });
          return;
        }

        await refreshDashboard(userId, chatId, {
          mode: TodoViewMode.IDLE,
        });
        return;

      case 'add': {
        if (!command.args) {
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.AWAIT_ADD,
          });
          return;
        }

        try {
          await addFromMessage(message, userId, chatId, command.args, 'command');
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.IDLE,
          });
        } catch (error) {
          if (error?.message === 'TODO_TEXT_TOO_LONG') {
            await refreshDashboard(userId, chatId, {
              mode: TodoViewMode.AWAIT_ADD,
              notice: 'Задача слишком длинная. Максимум 500 символов.',
            });
            return;
          }
          throw error;
        }
        return;
      }

      case 'done': {
        const id = parseId(command.args);
        if (!id) {
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.IDLE,
            notice: 'Использование: /done <id>',
          });
          return;
        }

        const todo = await markTodoDone(userId, id);
        await refreshDashboard(userId, chatId, {
          mode: TodoViewMode.IDLE,
          notice: todo ? null : `Активная задача #${id} не найдена.`,
        });
        return;
      }

      case 'delete': {
        if (!command.args) {
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.DELETE,
          });
          return;
        }

        const id = parseId(command.args);
        if (!id) {
          await refreshDashboard(userId, chatId, {
            mode: TodoViewMode.DELETE,
            notice: 'Использование: /delete <id>',
          });
          return;
        }

        const todo = await deleteTodo(userId, id);
        await refreshDashboard(userId, chatId, {
          mode: TodoViewMode.IDLE,
          notice: todo ? null : `Задача #${id} не найдена.`,
        });
        return;
      }

      default:
        await refreshDashboard(userId, chatId, {
          mode: TodoViewMode.IDLE,
          notice: `Неизвестная команда /${command.name}.`,
        });
    }
  } finally {
    await safeDeleteMessage(chatId, message.message_id);
  }
}
