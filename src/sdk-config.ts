/**
 * SDK Configuration
 * Agents, hooks, and MCP configuration for ClaudeN8N SDK
 */

import type {
  Options,
  AgentDefinition,
  HookCallbackMatcher,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  StopHookInput,
  HookJSONOutput,
  McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import { takeSnapshot, rollback } from './lib/snapshot.js';
import { runExternalTest } from './lib/external-test.js';

// ===========================================
// AGENTS (subagent definitions for Task tool)
// ===========================================

export const agents: Record<string, AgentDefinition> = {

  // Architect - понимает контекст, создаёт план
  architect: {
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
    ],
    model: 'sonnet',
  },

  // Researcher - глубокое исследование проблем
  researcher: {
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
    ],
    model: 'sonnet',
  },

  // Builder - ЕДИНСТВЕННЫЙ кто меняет workflow
  builder: {
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
    ],
    model: 'opus',
  },

  // QA - валидация, без изменений
  qa: {
    description: "Validates workflow structure and configuration. Reports errors with specific node names. NEVER fixes - only reports.",
    prompt: `You are the QA agent.

## Your Role
- 5-Phase validation (Structure -> Config -> Logic -> Special -> Testing)
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
    ],
    model: 'sonnet',
  },

  // Analyst - post-mortem, отчёты
  analyst: {
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
    ],
    model: 'sonnet',
  },
};

// ===========================================
// HOOKS (gate enforcement via SDK hooks)
// ===========================================

// State for snapshot/rollback
let currentWorkflowId: string | null = null;
let lastSnapshotVersion: number | null = null;

// Pre-tool hooks
const preToolUseHooks: HookCallbackMatcher[] = [
  // GATE: Snapshot before any workflow mutation
  {
    matcher: "mcp__n8n-mcp__n8n_update_*",
    hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      const preInput = input as PreToolUseHookInput;
      const toolInput = preInput.tool_input as { id?: string };
      const workflowId = toolInput?.id;

      if (workflowId) {
        currentWorkflowId = workflowId;
        const snapshot = await takeSnapshot(workflowId);
        if (!snapshot.success) {
          return {
            decision: 'block',
            reason: "Cannot proceed without snapshot. Aborting.",
          };
        }
        lastSnapshotVersion = snapshot.versionId ?? null;
        console.log(`[HOOK] Snapshot taken: v${snapshot.versionId}`);
      }

      return { continue: true };
    }],
  },

  // GATE: Snapshot before workflow creation
  {
    matcher: "mcp__n8n-mcp__n8n_create_workflow",
    hooks: [async (): Promise<HookJSONOutput> => {
      console.log(`[HOOK] Creating new workflow...`);
      // No snapshot needed for new workflows
      return { continue: true };
    }],
  },
];

// Post-tool hooks
const postToolUseHooks: HookCallbackMatcher[] = [
  // GATE 5: Verify MCP mutation happened
  {
    matcher: "mcp__n8n-mcp__n8n_update_*",
    hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      const postInput = input as PostToolUseHookInput;
      const result = postInput.tool_response as { error?: string } | undefined;

      if (!result || result.error) {
        console.error(`[HOOK] MCP mutation failed:`, result?.error);

        // Rollback
        if (currentWorkflowId && lastSnapshotVersion) {
          await rollback(currentWorkflowId, lastSnapshotVersion);
          console.log(`[HOOK] Rolled back to v${lastSnapshotVersion}`);
        }

        return {
          systemMessage: `MCP mutation failed: ${result?.error}. Changes rolled back.`,
        };
      }

      console.log(`[HOOK] MCP mutation verified`);
      return { continue: true };
    }],
  },

  // GATE 3 + SOFT_PASS: After QA validation
  {
    matcher: "mcp__n8n-mcp__n8n_validate_workflow",
    hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      const postInput = input as PostToolUseHookInput;
      const result = postInput.tool_response as {
        status?: string;
        phase_5_executed?: boolean;
        errors?: Array<{ severity?: string }>;
      } | undefined;

      if (!result) {
        return { continue: true };
      }

      // GATE 3: Phase 5 is mandatory
      if (result.status === 'PASS' && !result.phase_5_executed) {
        return {
          systemMessage: "GATE 3 VIOLATION: Cannot PASS without Phase 5 testing. Run n8n_test_workflow first.",
        };
      }

      // SOFT_PASS with blocking errors = FAIL
      if (result.status === 'SOFT_PASS') {
        const hasBlockingErrors = result.errors?.some(
          (e) => e.severity === 'error'
        );
        if (hasBlockingErrors) {
          console.log(`[HOOK] SOFT_PASS rejected: has blocking errors`);
          return {
            systemMessage: "SOFT_PASS rejected: workflow has blocking errors that must be fixed.",
          };
        }
      }

      return { continue: true };
    }],
  },

  // GATE 7: External Test after QA PASS
  {
    matcher: "mcp__n8n-mcp__n8n_test_workflow",
    hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      const postInput = input as PostToolUseHookInput;
      const result = postInput.tool_response as { success?: boolean } | undefined;

      // Only run external test if internal test passed
      if (result?.success && process.env.EXTERNAL_TEST_ENABLED === 'true') {
        console.log(`[HOOK] Running external Telegram test...`);

        const testCommand = process.env.EXTERNAL_TEST_COMMAND || '/day';
        const testPattern = process.env.EXTERNAL_TEST_PATTERN;

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
            systemMessage: `External test failed: ${externalResult.error}. Rolled back.`,
          };
        }

        console.log(`[HOOK] External test PASSED`);
      }

      return { continue: true };
    }],
  },
];

// Stop hooks
const stopHooks: HookCallbackMatcher[] = [
  {
    hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      const stopInput = input as StopHookInput;

      // Rollback on error
      if (stopInput.stop_hook_active && currentWorkflowId && lastSnapshotVersion) {
        console.log(`[HOOK] Error detected, rolling back...`);
        await rollback(currentWorkflowId, lastSnapshotVersion);
      }

      return { continue: true };
    }],
  },
];

export const hooks: Options['hooks'] = {
  PreToolUse: preToolUseHooks,
  PostToolUse: postToolUseHooks,
  Stop: stopHooks,
};

// ===========================================
// MCP SERVERS
// ===========================================

export function getMcpServers(): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {
    "n8n-mcp": {
      command: "npx",
      args: ["-y", "@n8n/n8n-mcp"],
      env: {
        N8N_API_URL: process.env.N8N_API_URL ?? '',
        N8N_API_KEY: process.env.N8N_API_KEY ?? '',
      },
    },
  };

  // Add Supabase if enabled
  if (process.env.SUPABASE_ENABLED === 'true') {
    servers["supabase"] = {
      command: "npx",
      args: ["-y", "@supabase/mcp"],
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL ?? '',
        SUPABASE_KEY: process.env.SUPABASE_KEY ?? '',
      },
    };
  }

  return servers;
}

// ===========================================
// BUILD OPTIONS (factory function)
// ===========================================

export function buildOptions(overrides?: Partial<Options>): Options {
  return {
    allowedTools: [
      "Read", "Glob", "Grep", "Write", "Task",
      "mcp__n8n-mcp__*",
      ...(process.env.SUPABASE_ENABLED === 'true' ? ["mcp__supabase__*"] : []),
    ],
    agents,
    hooks,
    mcpServers: getMcpServers(),
    permissionMode: "acceptEdits",
    maxTurns: 50,
    ...overrides,
  };
}

// ===========================================
// UTILITY: Reset state (for testing)
// ===========================================

export function resetState(): void {
  currentWorkflowId = null;
  lastSnapshotVersion = null;
}
