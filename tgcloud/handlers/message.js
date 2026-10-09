import { addTodo, deleteTodo, markTodoDone } from '../lib/todos.js';
import { setNewAccount } from '../lib/legacy.js';
import {
  DashboardMode,
  DashboardSection,
  getDashboardView,
  safeDeleteMessage,
  showDashboard,
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

async function addFromMessage(message, userId, chatId, text, source) {
  return await addTodo({
    userId,
    text,
    source,
    sourceChatId: chatId,
    sourceMessageId: message.message_id,
  });
}

async function showAndConsume(message, options) {
  const result = await showDashboard(options);
  await safeDeleteMessage(message.chat.id, message.message_id);
  return result;
}

export default async function (message, ctx) {
  if (!message?.chat?.id || !message?.from?.id || message.from.is_bot) return;
  if (typeof message.text !== 'string') return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const view = await getDashboardView(userId, chatId);
  const command = parseCommand(message.text);

  if (!command) {
    if (view?.mode === DashboardMode.TODO_AWAIT_ADD) {
      try {
        await addFromMessage(message, userId, chatId, message.text, 'dashboard');
        await showAndConsume(message, {
          userId,
          chatId,
          targetMessageId: view.messageId,
          section: DashboardSection.TODO,
          mode: DashboardMode.IDLE,
        });
      } catch (error) {
        if (error?.message !== 'TODO_TEXT_TOO_LONG') throw error;

        await showDashboard({
          userId,
          chatId,
          targetMessageId: view.messageId,
          section: DashboardSection.TODO,
          mode: DashboardMode.TODO_AWAIT_ADD,
          notice: 'Задача слишком длинная. Максимум 500 символов.',
        });
      }
      return;
    }

    if (view?.mode === DashboardMode.LEGACY_AWAIT_ACCOUNT) {
      try {
        await setNewAccount(userId, message.text, chatId);
        await showAndConsume(message, {
          userId,
          chatId,
          targetMessageId: view.messageId,
          section: DashboardSection.LEGACY,
          mode: DashboardMode.IDLE,
        });
      } catch (error) {
        if (error?.message !== 'NEW_ACCOUNT_INVALID') throw error;

        await showDashboard({
          userId,
          chatId,
          targetMessageId: view.messageId,
          section: DashboardSection.LEGACY,
          mode: DashboardMode.LEGACY_AWAIT_ACCOUNT,
          notice: 'Не удалось распознать имя пользователя Telegram. Используйте @username или t.me/username.',
        });
      }
    }

    return;
  }

  switch (command.name) {
    case 'start': {
      const fromBusinessBar = /^bizChat\d+$/i.test(command.args);
      await showAndConsume(message, {
        userId,
        chatId,
        section: fromBusinessBar ? DashboardSection.LEGACY : DashboardSection.HOME,
        mode: DashboardMode.IDLE,
      });
      return;
    }

    case 'help':
      await showAndConsume(message, {
        userId,
        chatId,
        section: DashboardSection.HOME,
        mode: DashboardMode.IDLE,
        notice: 'Выберите нужный раздел кнопками ниже.',
      });
      return;

    case 'legacy':
      await showAndConsume(message, {
        userId,
        chatId,
        section: DashboardSection.LEGACY,
        mode: DashboardMode.IDLE,
      });
      return;

    case 'todo':
      await showAndConsume(message, {
        userId,
        chatId,
        section: DashboardSection.TODO,
        mode: DashboardMode.IDLE,
        notice: command.args && command.args.toLowerCase() !== 'all'
          ? 'Использование: /todo'
          : null,
      });
      return;

    case 'add': {
      if (!command.args) {
        await showAndConsume(message, {
          userId,
          chatId,
          section: DashboardSection.TODO,
          mode: DashboardMode.TODO_AWAIT_ADD,
        });
        return;
      }

      try {
        await addFromMessage(message, userId, chatId, command.args, 'command');
        await showAndConsume(message, {
          userId,
          chatId,
          section: DashboardSection.TODO,
          mode: DashboardMode.IDLE,
        });
      } catch (error) {
        if (error?.message !== 'TODO_TEXT_TOO_LONG') throw error;

        await showDashboard({
          userId,
          chatId,
          section: DashboardSection.TODO,
          mode: DashboardMode.TODO_AWAIT_ADD,
          notice: 'Задача слишком длинная. Максимум 500 символов.',
        });
      }
      return;
    }

    case 'done': {
      const id = parseId(command.args);
      const todo = id ? await markTodoDone(userId, id) : null;

      await showAndConsume(message, {
        userId,
        chatId,
        section: DashboardSection.TODO,
        mode: DashboardMode.IDLE,
        notice: !id
          ? 'Использование: /done <id>'
          : (todo ? null : `Активная задача #${id} не найдена.`),
      });
      return;
    }

    case 'delete': {
      if (!command.args) {
        await showAndConsume(message, {
          userId,
          chatId,
          section: DashboardSection.TODO,
          mode: DashboardMode.TODO_DELETE,
        });
        return;
      }

      const id = parseId(command.args);
      const todo = id ? await deleteTodo(userId, id) : null;

      await showAndConsume(message, {
        userId,
        chatId,
        section: DashboardSection.TODO,
        mode: DashboardMode.IDLE,
        notice: !id
          ? 'Использование: /delete <id>'
          : (todo ? null : `Задача #${id} не найдена.`),
      });
      return;
    }

    default:
      await showAndConsume(message, {
        userId,
        chatId,
        section: view?.section ?? DashboardSection.HOME,
        mode: DashboardMode.IDLE,
        notice: `⚠️ Неизвестная команда /${command.name}.`,
      });
  }
}
