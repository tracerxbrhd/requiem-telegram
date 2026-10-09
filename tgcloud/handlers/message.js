import { api } from 'sdk';
import { addTodo, deleteTodo, listTodos, markTodoDone } from '../lib/todos.js';

const HELP = [
  'REQUIEM // TODO',
  '',
  '/add <задача> — добавить',
  '/todo — активные задачи',
  '/todo all — все задачи',
  '/done <id> — выполнить',
  '/delete <id> — удалить',
].join('\n');

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

function compactText(value, max = 110) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function formatTodos(rows, includeDone) {
  if (rows.length === 0) {
    return includeDone
      ? 'REQUIEM // TODO\n\nЗадач пока нет.'
      : 'REQUIEM // TODO\n\nАктивных задач нет.';
  }

  const lines = rows.map((todo) => {
    const mark = todo.done ? '✓' : '○';
    return `${mark} #${todo.id} ${compactText(todo.text)}`;
  });

  const suffix = rows.length >= 30
    ? '\n\nПоказаны первые 30 задач.'
    : '';

  return `REQUIEM // TODO\n\n${lines.join('\n')}${suffix}`;
}

async function reply(chatId, text) {
  await api.sendMessage({ chat_id: chatId, text });
}

export default async function (message, ctx) {
  if (!message?.chat?.id || !message?.from?.id || message.from.is_bot) return;
  if (typeof message.text !== 'string') return;

  const command = parseCommand(message.text);
  if (!command) return;

  const chatId = message.chat.id;
  const userId = message.from.id;

  switch (command.name) {
    case 'start':
    case 'help':
      await reply(chatId, HELP);
      return;

    case 'add': {
      if (!command.args) {
        await reply(chatId, 'Использование: /add <задача>');
        return;
      }

      try {
        const todo = await addTodo({
          userId,
          text: command.args,
          source: 'bot',
          sourceChatId: chatId,
          sourceMessageId: message.message_id,
        });
        await reply(chatId, `Добавлено: #${todo.id} ${todo.text}`);
      } catch (error) {
        if (error?.message === 'TODO_TEXT_TOO_LONG') {
          await reply(chatId, 'Задача слишком длинная. Максимум 500 символов.');
          return;
        }
        throw error;
      }
      return;
    }

    case 'todo': {
      const includeDone = command.args.toLowerCase() === 'all';
      if (command.args && !includeDone) {
        await reply(chatId, 'Использование: /todo или /todo all');
        return;
      }
      const rows = await listTodos(userId, { includeDone });
      await reply(chatId, formatTodos(rows, includeDone));
      return;
    }

    case 'done': {
      const id = parseId(command.args);
      if (!id) {
        await reply(chatId, 'Использование: /done <id>');
        return;
      }
      const todo = await markTodoDone(userId, id);
      await reply(chatId, todo ? `Готово: #${todo.id} ${todo.text}` : `Активная задача #${id} не найдена.`);
      return;
    }

    case 'delete': {
      const id = parseId(command.args);
      if (!id) {
        await reply(chatId, 'Использование: /delete <id>');
        return;
      }
      const todo = await deleteTodo(userId, id);
      await reply(chatId, todo ? `Удалено: #${todo.id} ${todo.text}` : `Задача #${id} не найдена.`);
      return;
    }

    default:
      await reply(chatId, `Не знаю команду /${command.name}.\n\n${HELP}`);
  }
}
