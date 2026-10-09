import { api } from 'sdk';
import { deleteTodo } from '../lib/todos.js';
import {
  getTodoView,
  showTodoDashboard,
  TodoViewMode,
} from '../lib/todo-ui.js';

async function answer(callbackQueryId, text = null) {
  const params = { callback_query_id: callbackQueryId };
  if (text) params.text = text;
  await api.answerCallbackQuery(params);
}

export default async function (callbackQuery, ctx) {
  const data = callbackQuery?.data;
  if (typeof data !== 'string' || !data.startsWith('todo:')) return;

  const userId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!userId || !chatId || !messageId) {
    await answer(callbackQuery.id, 'Эта кнопка больше недоступна.');
    return;
  }

  const view = await getTodoView(userId, chatId);
  if (!view || view.messageId !== messageId) {
    await answer(callbackQuery.id, 'Эта панель устарела. Используй /todo.');
    return;
  }

  if (data === 'todo:add') {
    await answer(callbackQuery.id);
    await showTodoDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      mode: TodoViewMode.AWAIT_ADD,
    });
    return;
  }

  if (data === 'todo:delete') {
    await answer(callbackQuery.id);
    await showTodoDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      mode: TodoViewMode.DELETE,
    });
    return;
  }

  if (data === 'todo:cancel') {
    await answer(callbackQuery.id);
    await showTodoDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      mode: TodoViewMode.IDLE,
    });
    return;
  }

  const deleteMatch = /^todo:del:(\d+)$/.exec(data);
  if (deleteMatch) {
    const id = Number(deleteMatch[1]);
    const todo = await deleteTodo(userId, id);

    await answer(
      callbackQuery.id,
      todo ? `Удалено: #${todo.id}` : `Задача #${id} уже отсутствует.`,
    );

    await showTodoDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      mode: TodoViewMode.IDLE,
    });
    return;
  }

  await answer(callbackQuery.id, 'Неизвестное действие.');
}
