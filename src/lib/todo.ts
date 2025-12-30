/**
 * TODO Manager
 * Task list management with Zod validation
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

// Zod schema for validation
const TaskSchema = z.object({
  id: z.string(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).default('pending'),
  title: z.string(),
  affectedNodes: z.array(z.string()).optional(),
  suggestedFix: z.string().optional(),
  testCommand: z.string().optional(),
  testExpectedPattern: z.string().optional(),
  error: z.string().optional(),
});

const TodoListSchema = z.object({
  analysisId: z.string().optional(),
  workflowId: z.string().optional(),
  generatedAt: z.string().optional(),
  tasks: z.array(TaskSchema),
});

export type TodoTask = z.infer<typeof TaskSchema>;
export type TodoList = z.infer<typeof TodoListSchema>;

const SESSIONS_DIR = process.env.SESSION_STORAGE_PATH ?? './sessions';

function getTodoPath(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId, 'TODO.json');
}

export async function saveTodo(sessionId: string, todo: TodoList): Promise<string> {
  // Validate with Zod
  const validated = TodoListSchema.parse(todo);

  const todoPath = getTodoPath(sessionId);
  await fs.mkdir(path.dirname(todoPath), { recursive: true });
  await fs.writeFile(todoPath, JSON.stringify(validated, null, 2));

  return todoPath;
}

export async function loadTodo(sessionId: string): Promise<TodoList | null> {
  try {
    const todoPath = getTodoPath(sessionId);
    const content = await fs.readFile(todoPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    // Validate with Zod
    return TodoListSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function updateTaskStatus(
  sessionId: string,
  taskId: string,
  status: TodoTask['status'],
  error?: string
): Promise<void> {
  const todo = await loadTodo(sessionId);
  if (!todo) return;

  const task = todo.tasks.find((t) => t.id === taskId);
  if (!task) return;

  task.status = status;
  if (error) task.error = error;

  await saveTodo(sessionId, todo);
}

export function getNextPendingTask(todo: TodoList): TodoTask | null {
  return todo.tasks.find((t) => t.status === 'pending') ?? null;
}

export function getPendingTasks(todo: TodoList): TodoTask[] {
  return todo.tasks.filter((t) => t.status === 'pending');
}

export function getCompletedTasks(todo: TodoList): TodoTask[] {
  return todo.tasks.filter((t) => t.status === 'completed');
}

export function getFailedTasks(todo: TodoList): TodoTask[] {
  return todo.tasks.filter((t) => t.status === 'failed');
}
