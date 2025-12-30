/**
 * Sequential Fix Flow
 * Each fix runs Builder agent with specific systemPrompt
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import { getMcpServers } from './sdk-config.js';
import { loadTodo, updateTaskStatus, type TodoTask } from './lib/todo.js';
import { getIsolatedNodes } from './lib/node-isolation.js';

export interface FixResult {
  success: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  details: TaskFixResult[];
}

export interface TaskFixResult {
  taskId: string;
  success: boolean;
  attempts: number;
  error?: string;
}

// Builder agent system prompt
const BUILDER_PROMPT = `You are the Builder agent. You FIX n8n workflows.

## CRITICAL RULES
1. ONLY modify nodes listed in the task - DO NOT touch other nodes
2. Use mcp__n8n-mcp__n8n_update_partial_workflow to apply changes
3. After ANY change, verify with mcp__n8n-mcp__n8n_get_workflow
4. If unsure, ask - do NOT guess

## Available Tools
- mcp__n8n-mcp__n8n_get_workflow - read workflow
- mcp__n8n-mcp__n8n_update_partial_workflow - apply fixes
- mcp__n8n-mcp__get_node - get node documentation
- mcp__n8n-mcp__validate_node - validate node config

## Process
1. Read the task and affected nodes
2. Understand what needs to change
3. Apply the fix with n8n_update_partial_workflow
4. Verify the change was applied

Be surgical. Minimal changes. Do not refactor unrelated code.`;

export async function runSequentialFix(
  sessionId: string,
  workflowId: string
): Promise<FixResult> {
  console.log('='.repeat(60));
  console.log('SEQUENTIAL FIX MODE (SDK Native)');
  console.log(`Session: ${sessionId}`);
  console.log(`Workflow: ${workflowId}`);
  console.log('='.repeat(60));

  // Load TODO
  const todo = await loadTodo(sessionId);
  if (!todo || !todo.tasks?.length) {
    throw new Error('No TODO found. Run analyze first.');
  }

  const pendingTasks = todo.tasks.filter((t) => t.status === 'pending');
  console.log(`\nTasks to fix: ${pendingTasks.length}`);

  const results: TaskFixResult[] = [];
  const mcpServers = getMcpServers();

  // Process tasks one by one
  for (const task of pendingTasks) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${task.priority}] ${task.title}`);
    console.log(`Nodes: ${task.affectedNodes?.join(', ') ?? 'none'}`);
    console.log('─'.repeat(60));

    await updateTaskStatus(sessionId, task.id, 'in_progress');

    const result = await fixSingleTask(sessionId, workflowId, task, mcpServers);

    results.push(result);

    if (result.success) {
      await updateTaskStatus(sessionId, task.id, 'completed');
      console.log(`✓ Task completed`);
    } else {
      await updateTaskStatus(sessionId, task.id, 'failed', result.error);
      console.log(`✗ Task failed: ${result.error}`);
    }
  }

  return {
    success: results.every((r) => r.success),
    tasksCompleted: results.filter((r) => r.success).length,
    tasksFailed: results.filter((r) => !r.success).length,
    details: results,
  };
}

async function fixSingleTask(
  sessionId: string,
  workflowId: string,
  task: TodoTask,
  mcpServers: ReturnType<typeof getMcpServers>
): Promise<TaskFixResult> {
  const maxAttempts = 3;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`\nAttempt ${attempt}/${maxAttempts}`);

    try {
      // Get isolated node context
      const nodeContext = await getIsolatedNodes(
        workflowId,
        task.affectedNodes ?? []
      );

      // Build fix prompt
      const fixPrompt = `FIX TASK in workflow ${workflowId}

## Task: ${task.title}
## Priority: ${task.priority}
## What to fix: ${task.suggestedFix ?? 'Apply appropriate fix'}

## Affected Nodes (ONLY modify these!):
${task.affectedNodes?.join(', ') ?? 'none specified'}

## Current Node Configuration:
${nodeContext}

## Instructions:
1. Analyze the issue
2. Apply the fix using n8n_update_partial_workflow
3. Verify the change was applied
4. Report success or failure

## Test After Fix:
- Command: ${task.testCommand ?? '/day'}
- Expected: ${task.testExpectedPattern ?? 'valid response'}`;

      const builderOptions: Options = {
        systemPrompt: BUILDER_PROMPT,
        allowedTools: [
          "mcp__n8n-mcp__n8n_get_workflow",
          "mcp__n8n-mcp__n8n_update_partial_workflow",
          "mcp__n8n-mcp__get_node",
          "mcp__n8n-mcp__validate_node",
        ],
        mcpServers,
        permissionMode: "acceptEdits",
        maxTurns: 20,
        resume: sessionId,
      };

      for await (const msg of query({ prompt: fixPrompt, options: builderOptions })) {
        if (isResult(msg)) {
          if (msg.subtype === 'success' && !msg.is_error) {
            // Check if result indicates success
            const resultText = msg.result.toLowerCase();
            if (resultText.includes('success') ||
                resultText.includes('applied') ||
                resultText.includes('fixed') ||
                resultText.includes('updated')) {
              return {
                taskId: task.id,
                success: true,
                attempts: attempt,
              };
            }
          }

          // Check for errors
          if (msg.subtype !== 'success' || msg.is_error) {
            throw new Error(getErrorFromResult(msg));
          }
        }
      }

      // If we got here without clear success, consider it done
      return {
        taskId: task.id,
        success: true,
        attempts: attempt,
      };

    } catch (error) {
      console.error(`  Attempt ${attempt} failed:`, (error as Error).message);

      if (attempt === maxAttempts) {
        return {
          taskId: task.id,
          success: false,
          attempts: attempt,
          error: (error as Error).message,
        };
      }

      // Wait before retry
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  return {
    taskId: task.id,
    success: false,
    attempts: maxAttempts,
    error: 'Max attempts exceeded',
  };
}

// Type guard
function isResult(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

// Extract error from result message
function getErrorFromResult(msg: SDKResultMessage): string {
  if ('errors' in msg && msg.errors) {
    return msg.errors.join(', ');
  }
  return 'Unknown error';
}
