# SDK Plan v2: Official Approach

**Дата**: 2025-12-28
**Подход**: Использование официальных SDK features
**Цель**: Решить все проблемы с минимальным кодом

---

## Архитектура: БЫЛО vs БУДЕТ

### БЫЛО (7 основных файлов):

```
src/
├── orchestrator/
│   ├── index.ts              # 512 lines - маршрутизация
│   ├── gate-enforcer.ts      # 377 lines - валидация
│   ├── session-manager.ts    # 377 lines - история
│   └── user-interface.ts     # UI
├── agents/
│   ├── base-agent.ts         # 360 lines - базовый класс
│   ├── architect.ts          # agent
│   ├── researcher.ts         # agent
│   ├── builder.ts            # agent
│   ├── qa.ts                 # agent
│   └── analyst.ts            # agent
└── orchestrators/analyze/
    ├── index.ts              # analyze flow
    └── fix-orchestrator.ts   # fix flow

Итого: ~2500+ строк orchestration кода
```

### БУДЕТ (3 основных файла):

```
src/
├── sdk-config.ts             # ~200 lines - agents + hooks + config
├── analyze-flow.ts           # ~150 lines - analyze mode
├── fix-flow.ts               # ~150 lines - sequential fix mode
└── lib/
    ├── node-isolation.ts     # ~100 lines - читать только нужные ноды
    ├── snapshot.ts           # ~50 lines - snapshot/rollback
    ├── external-test.ts      # ~50 lines - Telegram test
    └── todo.ts               # ~80 lines - TODO manager

Итого: ~780 строк (экономия 70%)
```

---

## Новая архитектура

### Главный файл: sdk-config.ts

```typescript
/**
 * SDK Configuration
 * Единственное место для настройки агентов, hooks, MCP
 */

import { ClaudeAgentOptions, AgentDefinition, HookMatcher } from '@anthropic-ai/claude-agent-sdk';
import { takeSnapshot, rollback } from './lib/snapshot.js';
import { runExternalTest } from './lib/external-test.js';
import { getIsolatedNodes } from './lib/node-isolation.js';

// ===========================================
// AGENTS (вместо 5 отдельных файлов)
// ===========================================

export const agents: Record<string, AgentDefinition> = {

  // Architect - понимает контекст, создаёт план
  "architect": {
    description: "Analyzes project context and creates blueprints. Use for understanding business logic, extracting requirements, creating TODO plans.",
    prompt: `You are the Architect agent.

## Your Role
- Read project files to understand business context
- Analyze workflow structure and purpose
- Create blueprints for new features
- Generate TODO.json with prioritized fix tasks

## Tools Available
- Read, Glob, Grep - for exploring project files
- mcp__n8n-mcp__n8n_get_workflow - for reading workflow structure
- mcp__supabase__list_tables - for understanding database schema

## Output Format
Always return structured JSON when asked for plans or todos.`,
    tools: [
      "Read", "Glob", "Grep",
      "mcp__n8n-mcp__n8n_get_workflow",
      "mcp__n8n-mcp__search_templates",
      "mcp__supabase__list_tables",
      "mcp__supabase__execute_sql",
    ]
  },

  // Researcher - глубокое исследование проблем
  "researcher": {
    description: "Investigates specific issues deeply. Use when you need to understand WHY something fails, find root causes, analyze execution history.",
    prompt: `You are the Researcher agent.

## Your Role
- Deep dive into specific issues
- Analyze execution history to find patterns
- Validate hypotheses about errors
- Find similar solutions in templates

## L-067 Protocol: Two-Step Analysis
1. First: mode=summary to find WHERE error occurs
2. Then: mode=filtered to find WHY it fails

## Tools Available
- n8n executions, validation, templates
- Supabase for data context`,
    tools: [
      "Read", "Glob", "Grep",
      "mcp__n8n-mcp__n8n_get_workflow",
      "mcp__n8n-mcp__n8n_executions",
      "mcp__n8n-mcp__n8n_validate_workflow",
      "mcp__n8n-mcp__search_templates",
      "mcp__n8n-mcp__get_node",
      "mcp__supabase__execute_sql",
    ]
  },

  // Builder - ЕДИНСТВЕННЫЙ кто меняет workflow
  "builder": {
    description: "Builds and fixes n8n workflows. ONLY agent that can mutate workflows. Use for creating new workflows or fixing specific nodes.",
    prompt: `You are the Builder agent.

## Your Role
- Create new workflows from blueprints
- Fix specific nodes (NEVER touch nodes outside edit_scope!)
- Apply surgical edits using n8n_update_partial_workflow

## CRITICAL RULES
1. NEVER read entire workflow - use isolated node context provided
2. ONLY modify nodes listed in edit_scope
3. After ANY mutation - verify with n8n_get_workflow
4. If removing >50% nodes - STOP and ask user

## L-075: Anti-Hallucination
- MUST make real MCP calls
- NEVER invent workflow IDs
- Verify changes were applied`,
    tools: [
      "mcp__n8n-mcp__n8n_create_workflow",
      "mcp__n8n-mcp__n8n_get_workflow",
      "mcp__n8n-mcp__n8n_update_partial_workflow",
      "mcp__n8n-mcp__n8n_autofix_workflow",
      "mcp__n8n-mcp__validate_node",
      "mcp__n8n-mcp__get_node",
    ]
  },

  // QA - валидация, без изменений
  "qa": {
    description: "Validates workflow structure and configuration. Reports errors with specific node names. NEVER fixes - only reports.",
    prompt: `You are the QA agent.

## Your Role
- 5-Phase validation (Structure → Config → Logic → Special → Testing)
- Generate edit_scope (list of nodes that need fixing)
- Filter false positives (L-053, L-054)

## CRITICAL: Phase 5 Testing is MANDATORY
- MUST execute n8n_test_workflow before returning PASS
- Without real test = cannot return PASS

## Output Format
{
  "status": "PASS|SOFT_PASS|FAIL|BLOCKED",
  "phase_5_executed": true,
  "errors": [...],
  "warnings": [...],
  "edit_scope": ["Node1", "Node2"]  // MAX 5 nodes!
}`,
    tools: [
      "mcp__n8n-mcp__n8n_get_workflow",
      "mcp__n8n-mcp__n8n_validate_workflow",
      "mcp__n8n-mcp__n8n_test_workflow",
      "mcp__n8n-mcp__n8n_executions",
      "mcp__n8n-mcp__validate_node",
    ]
  },

  // Analyst - post-mortem, отчёты
  "analyst": {
    description: "Synthesizes analysis reports and creates TODO.json. Use after investigation to create actionable fix plans.",
    prompt: `You are the Analyst agent.

## Your Role
- Create comprehensive analysis reports
- Generate TODO.json with prioritized tasks
- Each task must have: testCommand and testExpectedPattern

## TODO.json Format
{
  "tasks": [
    {
      "id": "task_001",
      "priority": "P0",
      "title": "Fix AI Agent Timeout",
      "affectedNodes": ["AI Agent"],
      "suggestedFix": "Add tool filtering",
      "testCommand": "/day",
      "testExpectedPattern": "калори|белк"
    }
  ]
}`,
    tools: [
      "Read", "Write", "Glob",
      "mcp__n8n-mcp__n8n_get_workflow",
    ]
  }
};

// ===========================================
// HOOKS (вместо GateEnforcer)
// ===========================================

// Текущий workflowId для snapshot
let currentWorkflowId: string | null = null;
let lastSnapshotVersion: number | null = null;

export const hooks = {

  // ─────────────────────────────────────────
  // PreToolUse: Перехват ПЕРЕД вызовом инструмента
  // ─────────────────────────────────────────
  PreToolUse: [

    // GATE: Snapshot перед любым изменением
    {
      matcher: "mcp__n8n-mcp__n8n_update_*|mcp__n8n-mcp__n8n_create_*",
      hooks: [async (input: any) => {
        const workflowId = input.tool_input?.id;
        if (workflowId) {
          currentWorkflowId = workflowId;
          const snapshot = await takeSnapshot(workflowId);
          if (!snapshot.success) {
            return { error: "Cannot proceed without snapshot. Aborting." };
          }
          lastSnapshotVersion = snapshot.versionId;
          console.log(`[HOOK] Snapshot taken: v${snapshot.versionId}`);
        }
        return {};
      }]
    },

    // Node Isolation: Перехватываем get_workflow для Builder
    {
      matcher: "mcp__n8n-mcp__n8n_get_workflow",
      hooks: [async (input: any, toolUseId: string, context: any) => {
        // Проверяем что это Builder и есть edit_scope
        const editScope = context.metadata?.editScope;
        if (editScope && editScope.length > 0) {
          // Заменяем на mode: structure (не full)
          console.log(`[HOOK] Node Isolation: reading only ${editScope.join(', ')}`);
          return {
            ...input,
            tool_input: {
              ...input.tool_input,
              mode: 'structure'  // Только структура, не весь контент
            }
          };
        }
        return {};
      }]
    }
  ],

  // ─────────────────────────────────────────
  // PostToolUse: Проверка ПОСЛЕ вызова инструмента
  // ─────────────────────────────────────────
  PostToolUse: [

    // GATE 5: Verify MCP mutation happened
    {
      matcher: "mcp__n8n-mcp__n8n_update_*|mcp__n8n-mcp__n8n_create_*",
      hooks: [async (input: any, toolUseId: string, context: any) => {
        const result = context.toolResult;
        if (!result || result.error) {
          console.error(`[HOOK] MCP mutation failed:`, result?.error);
          // Rollback
          if (currentWorkflowId && lastSnapshotVersion) {
            await rollback(currentWorkflowId, lastSnapshotVersion);
          }
          return { error: `MCP mutation failed: ${result?.error}` };
        }
        console.log(`[HOOK] MCP mutation verified`);
        return {};
      }]
    },

    // GATE 3 + SOFT_PASS: После QA валидации
    {
      matcher: "qa_validate|mcp__n8n-mcp__n8n_validate_workflow",
      hooks: [async (input: any, toolUseId: string, context: any) => {
        const result = context.toolResult;

        // GATE 3: Phase 5 обязательна
        if (result.status === 'PASS' && !result.phase_5_executed) {
          return {
            error: "GATE 3 VIOLATION: Cannot PASS without Phase 5 testing. Run n8n_test_workflow first."
          };
        }

        // SOFT_PASS с ошибками = FAIL
        if (result.status === 'SOFT_PASS') {
          const hasBlockingErrors = result.errors?.some(
            (e: any) => e.severity === 'error'
          );
          if (hasBlockingErrors) {
            console.log(`[HOOK] SOFT_PASS rejected: has blocking errors`);
            result.status = 'FAIL';  // Мутируем результат
          }
        }

        return {};
      }]
    },

    // GATE 7: External Test после QA PASS
    {
      matcher: "mcp__n8n-mcp__n8n_test_workflow",
      hooks: [async (input: any, toolUseId: string, context: any) => {
        const result = context.toolResult;

        // Если внутренний тест прошёл - проверяем внешний
        if (result.success && process.env.EXTERNAL_TEST_ENABLED === 'true') {
          console.log(`[HOOK] Running external Telegram test...`);

          const testCommand = context.metadata?.testCommand || '/day';
          const testPattern = context.metadata?.testExpectedPattern;

          const externalResult = await runExternalTest({
            message: testCommand,
            expectedPattern: testPattern,
          });

          if (!externalResult.success) {
            console.error(`[HOOK] External test FAILED:`, externalResult.error);

            // Rollback
            if (currentWorkflowId && lastSnapshotVersion) {
              await rollback(currentWorkflowId, lastSnapshotVersion);
              console.log(`[HOOK] Rolled back to v${lastSnapshotVersion}`);
            }

            return {
              error: `External test failed: ${externalResult.error}. Rolled back.`
            };
          }

          console.log(`[HOOK] External test PASSED`);
        }

        return {};
      }]
    }
  ],

  // ─────────────────────────────────────────
  // Stop: При остановке агента
  // ─────────────────────────────────────────
  Stop: [
    async (reason: string, context: any) => {
      if (reason === 'error' && currentWorkflowId && lastSnapshotVersion) {
        console.log(`[HOOK] Error detected, rolling back...`);
        await rollback(currentWorkflowId, lastSnapshotVersion);
      }
    }
  ]
};

// ===========================================
// MCP SERVERS
// ===========================================

export const mcpServers = {
  "n8n-mcp": {
    command: "npx",
    args: ["-y", "@n8n/n8n-mcp"],
    env: {
      N8N_API_URL: process.env.N8N_API_URL!,
      N8N_API_KEY: process.env.N8N_API_KEY!,
    }
  },
  // Supabase - опционально
  ...(process.env.SUPABASE_ENABLED === 'true' ? {
    "supabase": {
      command: "npx",
      args: ["-y", "@supabase/mcp"],
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL!,
        SUPABASE_KEY: process.env.SUPABASE_KEY!,
      }
    }
  } : {})
};

// ===========================================
// BUILD OPTIONS (фабрика)
// ===========================================

export function buildOptions(overrides?: Partial<ClaudeAgentOptions>): ClaudeAgentOptions {
  return {
    allowedTools: [
      "Read", "Glob", "Grep", "Write", "Task",
      "mcp__n8n-mcp__*",
      ...(process.env.SUPABASE_ENABLED === 'true' ? ["mcp__supabase__*"] : [])
    ],
    agents,
    hooks,
    mcpServers,
    permissionMode: "acceptEdits",
    maxTurns: 50,
    ...overrides
  };
}
```

---

## Новые Flow файлы

### analyze-flow.ts

```typescript
/**
 * Analyze Flow
 * Использует SDK sessions и subagents
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildOptions } from './sdk-config.js';
import { saveTodo, TodoList } from './lib/todo.js';

export interface AnalyzeResult {
  success: boolean;
  sessionId: string;
  todoPath?: string;
  report?: any;
  error?: string;
}

export async function analyzeWorkflow(
  workflowId: string,
  projectPath?: string
): Promise<AnalyzeResult> {

  console.log('═'.repeat(60));
  console.log('ANALYZE MODE (SDK Native)');
  console.log(`Workflow: ${workflowId}`);
  if (projectPath) console.log(`Project: ${projectPath}`);
  console.log('═'.repeat(60));

  let sessionId: string | undefined;
  let todoList: TodoList | undefined;

  try {
    // ─────────────────────────────────────────
    // PHASE 1: Architect understands context
    // ─────────────────────────────────────────
    console.log('\n[Phase 1] Architect analyzing context...');

    const architectPrompt = projectPath
      ? `Use the architect agent to:
         1. Read project files at ${projectPath} (start with README.md, ARCHITECTURE.md)
         2. Get workflow structure: ${workflowId}
         3. Understand what this workflow does and why
         4. Return a summary of business context`
      : `Use the architect agent to:
         1. Get workflow structure: ${workflowId}
         2. Analyze node purposes and data flow
         3. Return a summary of what this workflow does`;

    for await (const msg of query({
      prompt: architectPrompt,
      options: buildOptions()
    })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        console.log(`  Session: ${sessionId}`);
      }
      if ('result' in msg) {
        console.log(`  ✓ Context understood`);
      }
    }

    // ─────────────────────────────────────────
    // PHASE 2: Researcher investigates issues
    // ─────────────────────────────────────────
    console.log('\n[Phase 2] Researcher investigating...');

    for await (const msg of query({
      prompt: `Use the researcher agent to:
               1. Validate workflow ${workflowId}
               2. Check execution history for errors
               3. Identify all issues (config, logic, connections)
               4. Return list of problems found`,
      options: buildOptions({ resume: sessionId })
    })) {
      if ('result' in msg) {
        console.log(`  ✓ Investigation complete`);
      }
    }

    // ─────────────────────────────────────────
    // PHASE 3: Analyst creates TODO
    // ─────────────────────────────────────────
    console.log('\n[Phase 3] Analyst creating TODO...');

    for await (const msg of query({
      prompt: `Use the analyst agent to:
               1. Review all findings from architect and researcher
               2. Create TODO.json with prioritized fix tasks
               3. Each task must have:
                  - id, priority (P0/P1/P2), title
                  - affectedNodes (array of node names)
                  - suggestedFix (what to do)
                  - testCommand (Telegram command to test)
                  - testExpectedPattern (regex to validate response)
               4. Return the TODO.json content`,
      options: buildOptions({ resume: sessionId })
    })) {
      if ('result' in msg) {
        // Parse TODO from result
        try {
          const jsonMatch = msg.result.match(/```json\n([\s\S]*?)\n```/);
          if (jsonMatch) {
            todoList = JSON.parse(jsonMatch[1]);
          }
        } catch (e) {
          console.error('  ⚠ Failed to parse TODO');
        }
      }
    }

    // Save TODO
    let todoPath: string | undefined;
    if (todoList && sessionId) {
      todoPath = await saveTodo(sessionId, todoList);
      console.log(`  ✓ TODO saved: ${todoPath}`);
      console.log(`  Tasks: ${todoList.tasks?.length || 0}`);
    }

    return {
      success: true,
      sessionId: sessionId!,
      todoPath,
      report: todoList
    };

  } catch (error) {
    console.error('\n[Analyze] Failed:', error);
    return {
      success: false,
      sessionId: sessionId || 'unknown',
      error: (error as Error).message
    };
  }
}
```

### fix-flow.ts

```typescript
/**
 * Sequential Fix Flow
 * Один fix за раз, с проверкой после каждого
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildOptions } from './sdk-config.js';
import { loadTodo, updateTaskStatus, TodoTask } from './lib/todo.js';
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

export async function runSequentialFix(
  sessionId: string,
  workflowId: string
): Promise<FixResult> {

  console.log('═'.repeat(60));
  console.log('SEQUENTIAL FIX MODE (SDK Native)');
  console.log(`Session: ${sessionId}`);
  console.log(`Workflow: ${workflowId}`);
  console.log('═'.repeat(60));

  // Load TODO
  const todo = await loadTodo(sessionId);
  if (!todo || !todo.tasks?.length) {
    throw new Error('No TODO found. Run analyze first.');
  }

  const pendingTasks = todo.tasks.filter(t => t.status === 'pending');
  console.log(`\nTasks to fix: ${pendingTasks.length}`);

  const results: TaskFixResult[] = [];

  // Process tasks one by one
  for (const task of pendingTasks) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${task.priority}] ${task.title}`);
    console.log(`Nodes: ${task.affectedNodes?.join(', ')}`);
    console.log(`${'─'.repeat(60)}`);

    await updateTaskStatus(sessionId, task.id, 'in_progress');

    const result = await fixSingleTask(
      sessionId,
      workflowId,
      task
    );

    results.push(result);

    if (result.success) {
      await updateTaskStatus(sessionId, task.id, 'completed');
      console.log(`✓ Task completed`);
    } else {
      await updateTaskStatus(sessionId, task.id, 'failed', result.error);
      console.log(`✗ Task failed: ${result.error}`);
      // Продолжаем со следующей задачей
    }
  }

  return {
    success: results.every(r => r.success),
    tasksCompleted: results.filter(r => r.success).length,
    tasksFailed: results.filter(r => !r.success).length,
    details: results
  };
}

async function fixSingleTask(
  sessionId: string,
  workflowId: string,
  task: TodoTask
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
        task.affectedNodes || []
      );

      // Build fix prompt
      const fixPrompt = `
FIX SINGLE ISSUE in workflow ${workflowId}

## Task
${task.title}

## What to fix
${task.suggestedFix}

## Affected Nodes (ONLY touch these!)
${task.affectedNodes?.join(', ')}

## Node Context (isolated)
${nodeContext}

## Instructions
1. Use the builder agent
2. Apply fix using n8n_update_partial_workflow
3. ONLY modify listed nodes
4. Verify changes applied

## Test After Fix
Command: ${task.testCommand || '/day'}
Expected: ${task.testExpectedPattern || 'any response'}
`;

      // Run fix with resume (keeps full context)
      for await (const msg of query({
        prompt: fixPrompt,
        options: buildOptions({
          resume: sessionId,
          // Pass metadata for hooks
          metadata: {
            editScope: task.affectedNodes,
            testCommand: task.testCommand,
            testExpectedPattern: task.testExpectedPattern,
          }
        })
      })) {
        if ('result' in msg) {
          // Check if fix was successful (hooks will handle validation)
          if (!msg.result.includes('error') && !msg.result.includes('failed')) {
            return {
              taskId: task.id,
              success: true,
              attempts: attempt
            };
          }
        }
      }

      // If we got here without success, something went wrong
      throw new Error('Fix did not complete successfully');

    } catch (error) {
      console.error(`  Attempt ${attempt} failed:`, (error as Error).message);

      if (attempt === maxAttempts) {
        return {
          taskId: task.id,
          success: false,
          attempts: attempt,
          error: (error as Error).message
        };
      }

      // Wait before retry
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return {
    taskId: task.id,
    success: false,
    attempts: maxAttempts,
    error: 'Max attempts exceeded'
  };
}
```

---

## Библиотечные файлы (lib/)

### lib/node-isolation.ts

```typescript
/**
 * Node Isolation
 * Читает только нужные ноды, не весь workflow
 */

// Используем существующий MCP напрямую
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface IsolatedNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  inputs: string[];
  outputs: string[];
}

export async function getIsolatedNodes(
  workflowId: string,
  nodeNames: string[]
): Promise<string> {

  if (nodeNames.length === 0) {
    return "No specific nodes to isolate.";
  }

  // Получаем структуру workflow (не полные данные)
  let workflow: any;

  for await (const msg of query({
    prompt: `Call mcp__n8n-mcp__n8n_get_workflow with id="${workflowId}" and mode="structure". Return the raw result.`,
    options: {
      allowedTools: ["mcp__n8n-mcp__n8n_get_workflow"],
      maxTurns: 2
    }
  })) {
    if ('result' in msg) {
      try {
        const match = msg.result.match(/```json\n([\s\S]*?)\n```/);
        if (match) {
          workflow = JSON.parse(match[1]);
        }
      } catch {}
    }
  }

  if (!workflow?.nodes) {
    return "Could not load workflow structure.";
  }

  // Фильтруем только нужные ноды
  const isolated: IsolatedNode[] = [];

  for (const nodeName of nodeNames) {
    const node = workflow.nodes.find((n: any) => n.name === nodeName);
    if (!node) continue;

    // Находим connections
    const inputs: string[] = [];
    const outputs: string[] = [];

    // Входящие соединения
    for (const [source, conns] of Object.entries(workflow.connections || {})) {
      for (const outputType of Object.values(conns as any)) {
        for (const connArr of (outputType as any[])) {
          if (connArr.some((c: any) => c.node === nodeName)) {
            inputs.push(source);
          }
        }
      }
    }

    // Исходящие соединения
    const nodeConns = workflow.connections?.[nodeName];
    if (nodeConns) {
      for (const outputType of Object.values(nodeConns)) {
        for (const connArr of (outputType as any[])) {
          for (const target of connArr) {
            outputs.push(target.node);
          }
        }
      }
    }

    isolated.push({
      name: node.name,
      type: node.type,
      typeVersion: node.typeVersion,
      parameters: node.parameters,
      inputs: [...new Set(inputs)],
      outputs: [...new Set(outputs)],
    });
  }

  // Форматируем для промпта
  let result = `## Isolated Node Context (${isolated.length} nodes)\n\n`;

  for (const node of isolated) {
    result += `### ${node.name}\n`;
    result += `Type: ${node.type} v${node.typeVersion}\n`;
    result += `Receives from: ${node.inputs.join(', ') || 'none'}\n`;
    result += `Sends to: ${node.outputs.join(', ') || 'none'}\n`;
    result += `\nParameters:\n\`\`\`json\n${JSON.stringify(node.parameters, null, 2)}\n\`\`\`\n\n`;
  }

  return result;
}
```

### lib/snapshot.ts

```typescript
/**
 * Snapshot Manager
 * Простой snapshot/rollback через n8n API
 */

export interface SnapshotResult {
  success: boolean;
  versionId?: number;
  error?: string;
}

// Храним последние snapshots
const snapshots = new Map<string, number[]>();

export async function takeSnapshot(workflowId: string): Promise<SnapshotResult> {
  try {
    // Получаем текущую версию через n8n API
    const response = await fetch(
      `${process.env.N8N_API_URL}/workflows/${workflowId}`,
      {
        headers: {
          'X-N8N-API-KEY': process.env.N8N_API_KEY!
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get workflow: ${response.status}`);
    }

    const workflow = await response.json();
    const versionId = workflow.versionId;

    // Сохраняем
    const existing = snapshots.get(workflowId) || [];
    existing.push(versionId);
    snapshots.set(workflowId, existing);

    console.log(`[Snapshot] Saved v${versionId} for ${workflowId}`);

    return { success: true, versionId };
  } catch (error) {
    console.error('[Snapshot] Failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function rollback(
  workflowId: string,
  toVersion?: number
): Promise<boolean> {
  try {
    const versions = snapshots.get(workflowId);
    if (!versions || versions.length === 0) {
      console.error('[Rollback] No snapshots found');
      return false;
    }

    const targetVersion = toVersion || versions[versions.length - 1];

    // Используем n8n API для rollback
    const response = await fetch(
      `${process.env.N8N_API_URL}/workflows/${workflowId}/versions/${targetVersion}/rollback`,
      {
        method: 'POST',
        headers: {
          'X-N8N-API-KEY': process.env.N8N_API_KEY!
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Rollback failed: ${response.status}`);
    }

    console.log(`[Rollback] Restored to v${targetVersion}`);

    // Удаляем использованный snapshot
    if (!toVersion) {
      versions.pop();
    }

    return true;
  } catch (error) {
    console.error('[Rollback] Failed:', error);
    return false;
  }
}
```

### lib/external-test.ts

```typescript
/**
 * External Tester
 * Тестирует через Telegram webhook
 */

export interface ExternalTestRequest {
  message: string;
  expectedPattern?: string;
}

export interface ExternalTestResult {
  success: boolean;
  response?: string;
  error?: string;
}

export async function runExternalTest(
  request: ExternalTestRequest
): Promise<ExternalTestResult> {

  const webhookUrl = process.env.EXTERNAL_TEST_WEBHOOK_URL;
  const botUsername = process.env.EXTERNAL_TEST_BOT_USERNAME || '@Multi_Bot0101_bot';
  const timeout = parseInt(process.env.EXTERNAL_TEST_TIMEOUT || '20000');

  if (!webhookUrl) {
    console.log('[ExternalTest] Not configured, skipping');
    return { success: true };  // Skip if not configured
  }

  // Retry logic
  const maxRetries = 3;
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[ExternalTest] Attempt ${attempt}/${maxRetries}: ${request.message}`);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_username: botUsername,
          message: request.message,
          scope: 'sdk_fix_validation'
        }),
        signal: AbortSignal.timeout(timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      // Check result
      if (data.failed > 0) {
        throw new Error(`Test failed: ${data.results?.[0]?.error || 'unknown'}`);
      }

      // Validate pattern if provided
      if (request.expectedPattern && data.results?.[0]?.response_received) {
        const regex = new RegExp(request.expectedPattern, 'i');
        if (!regex.test(data.results[0].response_received)) {
          throw new Error(`Response didn't match pattern: ${request.expectedPattern}`);
        }
      }

      return {
        success: true,
        response: data.results?.[0]?.response_received
      };

    } catch (error) {
      lastError = (error as Error).message;
      console.error(`[ExternalTest] Attempt ${attempt} failed:`, lastError);

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`
  };
}
```

### lib/todo.ts

```typescript
/**
 * TODO Manager
 * Управление списком задач
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

// Zod schema для валидации
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

const SESSIONS_DIR = process.env.SESSION_STORAGE_PATH || './sessions';

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
    const parsed = JSON.parse(content);

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

  const task = todo.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.status = status;
  if (error) task.error = error;

  await saveTodo(sessionId, todo);
}

export function getNextPendingTask(todo: TodoList): TodoTask | null {
  return todo.tasks.find(t => t.status === 'pending') || null;
}
```

---

## Entry Point: index.ts

```typescript
/**
 * ClaudeN8N SDK - Entry Point
 * Simplified with official SDK approach
 */

import 'dotenv/config';
import { analyzeWorkflow } from './analyze-flow.js';
import { runSequentialFix } from './fix-flow.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'analyze': {
      const workflowId = args[1];
      const projectPath = args[2];

      if (!workflowId) {
        console.error('Usage: npm run analyze <workflowId> [projectPath]');
        process.exit(1);
      }

      const result = await analyzeWorkflow(workflowId, projectPath);

      if (result.success) {
        console.log('\n✓ Analysis complete');
        console.log(`Session: ${result.sessionId}`);
        console.log(`TODO: ${result.todoPath}`);
        console.log('\nTo apply fixes:');
        console.log(`npm run fix ${result.sessionId} ${workflowId}`);
      } else {
        console.error('\n✗ Analysis failed:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'fix': {
      const sessionId = args[1];
      const workflowId = args[2];

      if (!sessionId || !workflowId) {
        console.error('Usage: npm run fix <sessionId> <workflowId>');
        process.exit(1);
      }

      const result = await runSequentialFix(sessionId, workflowId);

      console.log('\n' + '═'.repeat(60));
      console.log('FIX COMPLETE');
      console.log(`Completed: ${result.tasksCompleted}`);
      console.log(`Failed: ${result.tasksFailed}`);
      break;
    }

    default:
      console.log('ClaudeN8N SDK v2.0');
      console.log('\nCommands:');
      console.log('  npm run analyze <workflowId> [projectPath]');
      console.log('  npm run fix <sessionId> <workflowId>');
  }
}

main().catch(console.error);
```

---

## .env.example

```bash
# Required: n8n API
N8N_API_URL=https://your-n8n.com/api/v1
N8N_API_KEY=your-api-key

# Required: Anthropic
ANTHROPIC_API_KEY=your-anthropic-key

# Optional: External Testing
EXTERNAL_TEST_ENABLED=true
EXTERNAL_TEST_WEBHOOK_URL=https://n8n.srv1068954.hstgr.cloud/webhook/bot-test
EXTERNAL_TEST_BOT_USERNAME=@Multi_Bot0101_bot
EXTERNAL_TEST_TIMEOUT=20000

# Optional: Supabase Context
SUPABASE_ENABLED=false
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your-key

# Storage
SESSION_STORAGE_PATH=./sessions
```

---

## Миграционный план

### Что УДАЛЯЕМ:

```diff
- src/orchestrator/index.ts           # 512 lines → SDK subagents
- src/orchestrator/gate-enforcer.ts   # 377 lines → SDK hooks
- src/orchestrator/session-manager.ts # 377 lines → SDK sessions
- src/agents/base-agent.ts            # 360 lines → SDK query()
- src/orchestrators/analyze/index.ts  # → analyze-flow.ts
- src/orchestrators/analyze/fix-orchestrator.ts # → fix-flow.ts
```

### Что ОСТАВЛЯЕМ (с модификацией):

```
src/agents/architect.ts   → Перемещаем prompt в sdk-config.ts
src/agents/builder.ts     → Перемещаем prompt в sdk-config.ts
src/agents/qa.ts          → Перемещаем prompt в sdk-config.ts
src/agents/researcher.ts  → Перемещаем prompt в sdk-config.ts
src/agents/analyst.ts     → Перемещаем prompt в sdk-config.ts
```

### Что СОЗДАЁМ:

```
src/sdk-config.ts         # Центральная конфигурация
src/analyze-flow.ts       # Analyze mode
src/fix-flow.ts           # Fix mode
src/lib/node-isolation.ts # Node isolation
src/lib/snapshot.ts       # Snapshot/rollback
src/lib/external-test.ts  # Telegram testing
src/lib/todo.ts           # TODO management
```

---

## Сравнение: Было vs Стало

| Метрика | Было | Стало | Изменение |
|---------|------|-------|-----------|
| Файлов orchestration | 7 | 3 | -57% |
| Строк кода | ~2500 | ~780 | -70% |
| Точек отказа | 7 компонентов | 3 компонента | -57% |
| State хранилищ | 3 (Session, Context, Todo) | 1 (SDK + Todo) | -66% |

---

## Решённые проблемы

| Проблема | Как решена |
|----------|-----------|
| Builder читает 217K | Node Isolation + PreToolUse hook |
| SOFT_PASS пропускает | PostToolUse hook мутирует status |
| Нет rollback | PreToolUse snapshot + Stop hook rollback |
| Нет контекста проекта | Architect agent с Read/Glob/Grep |
| Все фиксы сразу | Sequential fix loop с TODO |
| Нет реального теста | PostToolUse hook + external-test.ts |
| Нет Supabase | Опциональный MCP server |

---

## Порядок реализации

### Week 1: Основа

```
Day 1-2: sdk-config.ts (agents + hooks)
Day 3:   lib/snapshot.ts + lib/external-test.ts
Day 4:   lib/todo.ts (с Zod validation)
Day 5:   lib/node-isolation.ts
```

### Week 2: Flows

```
Day 1-2: analyze-flow.ts
Day 3-4: fix-flow.ts
Day 5:   index.ts + testing
```

### Week 3: Миграция

```
Day 1-2: Удаление старых файлов
Day 3-4: Тестирование на реальном workflow
Day 5:   Документация
```

---

## Что дальше?

После одобрения плана:
1. Начинаем с `sdk-config.ts` - центральная точка
2. Затем `lib/` файлы - независимые модули
3. Затем flows - используют sdk-config и lib
4. В конце миграция - удаляем старое

Готов начать?
