import { db } from 'sdk';
import { and, asc, eq } from 'sdk/db';
import { todos } from '../schema.js';

const MAX_TODO_LENGTH = 500;

export function normalizeTodoText(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new Error('TODO_TEXT_EMPTY');
  if (text.length > MAX_TODO_LENGTH) throw new Error('TODO_TEXT_TOO_LONG');
  return text;
}

export async function addTodo({
  userId,
  text,
  source = 'bot',
  sourceChatId = null,
  sourceMessageId = null,
}) {
  const cleanText = normalizeTodoText(text);
  const rows = await db.insert(todos).values({
    userId,
    text: cleanText,
    source,
    sourceChatId,
    sourceMessageId,
  }).returning({ id: todos.id, text: todos.text });

  return rows[0] ?? null;
}

export async function listTodos(userId, { includeDone = false, limit = 30 } = {}) {
  const where = includeDone
    ? eq(todos.userId, userId)
    : and(eq(todos.userId, userId), eq(todos.done, false));

  return await db.select().from(todos)
    .where(where)
    .orderBy(asc(todos.id))
    .limit(limit)
    .all();
}

export async function markTodoDone(userId, id) {
  const rows = await db.update(todos)
    .set({ done: true, completedAt: new Date() })
    .where(and(eq(todos.userId, userId), eq(todos.id, id), eq(todos.done, false)))
    .returning({ id: todos.id, text: todos.text });

  return rows[0] ?? null;
}

export async function deleteTodo(userId, id) {
  const rows = await db.delete(todos)
    .where(and(eq(todos.userId, userId), eq(todos.id, id)))
    .returning({ id: todos.id, text: todos.text });

  return rows[0] ?? null;
}
