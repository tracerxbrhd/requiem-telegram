import { api } from 'sdk';
import { deleteTodo, markTodoDone } from '../lib/todos.js';
import {
  cycleHeartbeat,
  ensureLegacySettings,
  LegacyMode,
  renewLegacyStatus,
  setLegacyMode,
  setNewAccount,
  toggleManualLegacy,
} from '../lib/legacy.js';
import {
  DashboardMode,
  DashboardSection,
  getDashboardView,
  showDashboard,
} from '../lib/todo-ui.js';

async function answer(callbackQueryId, text = null) {
  const params = { callback_query_id: callbackQueryId };
  if (text) params.text = text;
  await api.answerCallbackQuery(params);
}

async function assertDashboardCallback(callbackQuery, userId, chatId, messageId) {
  const view = await getDashboardView(userId, chatId);
  if (!view || view.messageId !== messageId) {
    await answer(callbackQuery.id, 'Эта панель устарела. Используй /start.');
    return null;
  }
  return view;
}

export default async function (callbackQuery, ctx) {
  const data = callbackQuery?.data;
  if (typeof data !== 'string') return;

  const userId = callbackQuery.from?.id;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!userId || !chatId || !messageId) {
    await answer(callbackQuery.id, 'Эта кнопка больше недоступна.');
    return;
  }

  if (data === 'legacy:renew_reminder') {
    await renewLegacyStatus(userId, chatId);
    await answer(callbackQuery.id, 'Статус продлён.');

    const view = await getDashboardView(userId, chatId);
    if (view?.messageId) {
      await showDashboard({
        userId,
        chatId,
        targetMessageId: view.messageId,
        section: DashboardSection.LEGACY,
        mode: DashboardMode.IDLE,
      });
    }
    return;
  }

  if (data === 'noop') {
    await answer(callbackQuery.id);
    return;
  }

  const view = await assertDashboardCallback(
    callbackQuery,
    userId,
    chatId,
    messageId,
  );
  if (!view) return;

  if (data === 'panel:home' || data === 'panel:todo' || data === 'panel:legacy') {
    const section = data === 'panel:todo'
      ? DashboardSection.TODO
      : data === 'panel:legacy'
        ? DashboardSection.LEGACY
        : DashboardSection.HOME;

    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'todo:add') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.TODO_AWAIT_ADD,
    });
    return;
  }

  if (data === 'todo:complete') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.TODO_COMPLETE,
    });
    return;
  }

  if (data === 'todo:delete') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.TODO_DELETE,
    });
    return;
  }

  if (data === 'todo:cancel') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  const doneMatch = /^todo:done:(\d+)$/.exec(data);
  if (doneMatch) {
    const id = Number(doneMatch[1]);
    const todo = await markTodoDone(userId, id);

    await answer(
      callbackQuery.id,
      todo ? `Завершено: #${todo.id}` : `Задача #${id} уже завершена или отсутствует.`,
    );

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.IDLE,
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

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.TODO,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:mode') {
    const settings = await ensureLegacySettings(userId, chatId);
    const nextMode = settings.activationMode === LegacyMode.MANUAL
      ? LegacyMode.DEADMAN
      : LegacyMode.MANUAL;

    await setLegacyMode(userId, nextMode, chatId);
    await answer(
      callbackQuery.id,
      nextMode === LegacyMode.DEADMAN ? 'Dead-man режим включён.' : 'Ручной режим включён.',
    );

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:manual_toggle') {
    const settings = await toggleManualLegacy(userId, chatId);
    await answer(
      callbackQuery.id,
      settings.manualActive ? 'Автоответ активирован.' : 'Автоответ отключён.',
    );

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:renew') {
    await renewLegacyStatus(userId, chatId);
    await answer(callbackQuery.id, 'Статус продлён.');

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:interval') {
    const settings = await cycleHeartbeat(userId, chatId);
    await answer(callbackQuery.id, `Интервал: ${settings.heartbeatDays} дн.`);

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:account') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.LEGACY_AWAIT_ACCOUNT,
    });
    return;
  }

  if (data === 'legacy:account_clear') {
    await setNewAccount(userId, null, chatId);
    await answer(callbackQuery.id, 'Новый аккаунт очищен.');

    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  if (data === 'legacy:cancel') {
    await answer(callbackQuery.id);
    await showDashboard({
      userId,
      chatId,
      targetMessageId: messageId,
      section: DashboardSection.LEGACY,
      mode: DashboardMode.IDLE,
    });
    return;
  }

  await answer(callbackQuery.id, 'Неизвестное действие.');
}
