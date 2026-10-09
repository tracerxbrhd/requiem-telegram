import { table, integer, text, boolean, index, uniqueIndex, sql } from 'sdk/db';

export const todos = table('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  source: text('source').notNull().default('bot'),
  sourceChatId: integer('source_chat_id'),
  sourceMessageId: integer('source_message_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
}, (t) => ({
  userDoneIdx: index('idx_todos_user_done').on(t.userId, t.done),
  userIdIdx: index('idx_todos_user_id').on(t.userId, t.id),
}));

export const todoViews = table('todo_views', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  chatId: integer('chat_id').notNull(),
  messageId: integer('message_id').notNull(),
  section: text('section').notNull().default('home'),
  mode: text('mode').notNull().default('idle'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  userChatUnique: uniqueIndex('uidx_todo_views_user_chat').on(t.userId, t.chatId),
}));

export const legacySettings = table('legacy_settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').notNull().unique(),
  ownerChatId: integer('owner_chat_id'),
  activationMode: text('activation_mode').notNull().default('manual'),
  manualActive: boolean('manual_active').notNull().default(false),
  heartbeatDays: integer('heartbeat_days').notNull().default(7),
  lastAliveAt: integer('last_alive_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  newAccount: text('new_account'),
  reminderSentAt: integer('reminder_sent_at', { mode: 'timestamp' }),
  reminderMessageId: integer('reminder_message_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const businessConnections = table('business_connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  connectionId: text('connection_id').notNull().unique(),
  ownerUserId: integer('owner_user_id').notNull(),
  userChatId: integer('user_chat_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  canReply: boolean('can_reply').notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  ownerIdx: index('idx_business_connections_owner').on(t.ownerUserId),
}));

export const legacyNotifications = table('legacy_notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerUserId: integer('owner_user_id').notNull(),
  connectionId: text('connection_id').notNull(),
  chatId: integer('chat_id').notNull(),
  sentAt: integer('sent_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  ownerChatUnique: uniqueIndex('uidx_legacy_notifications_owner_chat')
    .on(t.ownerUserId, t.chatId),
}));
