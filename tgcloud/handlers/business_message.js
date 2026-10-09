import { api } from 'sdk';
import {
  buildLegacyAutoReply,
  buildLegacyRichMessage,
  ensureBusinessConnection,
  ensureLegacySettings,
  hasLegacyNotification,
  isLegacyActive,
  legacyReplyMarkup,
  maybeSendHeartbeatReminder,
  recordLegacyNotification,
} from '../lib/legacy.js';

export default async function (message, ctx) {
  const connectionId = message?.business_connection_id;
  const chatId = message?.chat?.id;
  const senderId = message?.from?.id;

  if (!connectionId || !chatId || !senderId) return;
  if (message.chat?.type !== 'private') return;
  if (message.from?.is_bot) return;

  const connection = await ensureBusinessConnection(connectionId);
  if (!connection?.enabled || !connection.canReply) return;

  // Telegram delivers both incoming and outgoing business messages.
  // Never react to messages sent by the account owner or by a business bot.
  if (senderId === connection.ownerUserId || message.sender_business_bot) return;

  const settings = await ensureLegacySettings(
    connection.ownerUserId,
    connection.userChatId,
  );

  try {
    await maybeSendHeartbeatReminder(settings);
  } catch (error) {
    console.warn('Could not send heartbeat reminder', {
      ownerUserId: connection.ownerUserId,
      code: error?.code,
      description: error?.description,
    });
  }

  if (!isLegacyActive(settings)) return;
  if (await hasLegacyNotification(connection.ownerUserId, chatId)) return;

  const common = {
    business_connection_id: connectionId,
    chat_id: chatId,
    reply_parameters: {
      message_id: message.message_id,
    },
    reply_markup: legacyReplyMarkup(),
  };

  try {
    await api.sendRichMessage({
      ...common,
      rich_message: buildLegacyRichMessage(settings),
    });
  } catch (error) {
    console.warn('Rich Legacy message unavailable; falling back to formatted text', {
      ownerUserId: connection.ownerUserId,
      chatId,
      code: error?.code,
      description: error?.description,
      message: error?.message,
    });

    await api.sendMessage({
      ...common,
      text: buildLegacyAutoReply(settings),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  await recordLegacyNotification(
    connection.ownerUserId,
    connectionId,
    chatId,
  );
}
