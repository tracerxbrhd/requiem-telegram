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
  mode: text('mode').notNull().default('idle'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (t) => ({
  userChatUnique: uniqueIndex('uidx_todo_views_user_chat').on(t.userId, t.chatId),
}));
