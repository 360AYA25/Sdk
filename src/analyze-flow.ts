/**
 * Analyze Flow
 * Each phase runs Claude with specific agent systemPrompt
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage, SDKResultMessage, SDKSystemMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import { getMcpServers } from './sdk-config.js';
import { saveTodo, type TodoList } from './lib/todo.js';

export interface AnalyzeResult {
  success: boolean;
  sessionId: string;
  todoPath?: string;
  report?: TodoList;
  error?: string;
}

// Agent system prompts
const ARCHITECT_PROMPT = `You are the Architect agent for n8n workflow analysis.

## Your Role
- Read project files to understand business context
- Analyze workflow structure and purpose
- Understand what each node does and why

## Instructions
1. Use mcp__n8n-mcp__n8n_get_workflow to fetch the workflow
2. If project path provided, read README.md, ARCHITECTURE.md for context
3. Analyze node purposes and data flow
4. Return a clear summary of what this workflow does

Be concise. Focus on understanding the business logic.`;

const RESEARCHER_PROMPT = `You are the Researcher agent for n8n workflow validation.

## Your Role
- Deep dive into specific issues
- Analyze execution history to find patterns
- Validate workflow configuration
- Find all bugs and problems

## Instructions
1. Use mcp__n8n-mcp__n8n_validate_workflow to check structure
2. Use mcp__n8n-mcp__n8n_executions to check error history
3. Identify ALL issues: config errors, logic bugs, connection problems
4. Return a detailed list of problems found

Be thorough. Check every node configuration.`;

const ANALYST_PROMPT = `You are the Analyst agent. Create a TODO.json with fix tasks.

## Your Role
- Synthesize findings into actionable tasks
- Prioritize by severity (P0=critical, P1=important, P2=minor)
- Each task must be specific and testable

## Output Format
Return ONLY a JSON object in this exact format:
\`\`\`json
{
  "tasks": [
    {
      "id": "FIX-001",
      "priority": "P0",
      "title": "Fix specific issue description",
      "affectedNodes": ["NodeName1", "NodeName2"],
      "suggestedFix": "What to change",
      "testCommand": "/day",
      "testExpectedPattern": "калори|белк"
    }
  ]
}
\`\`\`

CRITICAL: Return ONLY the JSON block, no other text.`;

export async function analyzeWorkflow(
  workflowId: string,
  projectPath?: string
): Promise<AnalyzeResult> {
  console.log('='.repeat(60));
  console.log('ANALYZE MODE (SDK Native)');
  console.log(`Workflow: ${workflowId}`);
  if (projectPath) console.log(`Project: ${projectPath}`);
  console.log('='.repeat(60));

  let sessionId: string | undefined;
  let todoList: TodoList | undefined;

  const mcpServers = getMcpServers();

  try {
    // ─────────────────────────────────────────
    // PHASE 1: Architect understands context
    // ─────────────────────────────────────────
    console.log('\n[Phase 1] Architect analyzing context...');

    const architectTask = projectPath
      ? `Analyze workflow ${workflowId} with project context at ${projectPath}.
         Read project docs first (README.md, ARCHITECTURE.md), then analyze the workflow.`
      : `Analyze workflow ${workflowId}.
         Fetch the workflow and explain what it does.`;

    const architectOptions: Options = {
      systemPrompt: ARCHITECT_PROMPT,
      allowedTools: [
        "Read", "Glob", "Grep",
        "mcp__n8n-mcp__n8n_get_workflow",
      ],
      mcpServers,
      permissionMode: "acceptEdits",
      maxTurns: 20,
    };

    for await (const msg of query({ prompt: architectTask, options: architectOptions })) {
      if (isSystemInit(msg)) {
        sessionId = msg.session_id;
        console.log(`  Session: ${sessionId}`);
      }
      if (isResult(msg)) {
        if (msg.subtype === 'success') {
          console.log(`  ✓ Context understood`);
        } else {
          console.log(`  ⚠ Phase 1 issue: ${msg.subtype}`);
        }
      }
    }

    if (!sessionId) {
      throw new Error('Failed to get session ID');
    }

    // ─────────────────────────────────────────
    // PHASE 2: Researcher investigates issues
    // ─────────────────────────────────────────
    console.log('\n[Phase 2] Researcher investigating...');

    const researcherTask = `Validate workflow ${workflowId}:
1. Run validation to check structure
2. Check execution history for errors
3. List ALL issues found (config, logic, connections)`;

    const researcherOptions: Options = {
      systemPrompt: RESEARCHER_PROMPT,
      allowedTools: [
        "mcp__n8n-mcp__n8n_get_workflow",
        "mcp__n8n-mcp__n8n_validate_workflow",
        "mcp__n8n-mcp__n8n_executions",
        "mcp__n8n-mcp__get_node",
      ],
      mcpServers,
      permissionMode: "acceptEdits",
      maxTurns: 30,
      resume: sessionId,
    };

    for await (const msg of query({ prompt: researcherTask, options: researcherOptions })) {
      if (isResult(msg)) {
        if (msg.subtype === 'success') {
          console.log(`  ✓ Investigation complete`);
        } else {
          console.log(`  ⚠ Phase 2 issue: ${msg.subtype}`);
        }
      }
    }

    // ─────────────────────────────────────────
    // PHASE 3: Analyst creates TODO
    // ─────────────────────────────────────────
    console.log('\n[Phase 3] Analyst creating TODO...');

    const analystTask = `Based on the analysis above, create a TODO.json with all fix tasks.
Include ALL issues found. Each task needs: id, priority, title, affectedNodes, suggestedFix, testCommand, testExpectedPattern.
Return ONLY the JSON.`;

    const analystOptions: Options = {
      systemPrompt: ANALYST_PROMPT,
      allowedTools: [],  // Analyst doesn't need tools, just synthesizes
      mcpServers,
      permissionMode: "acceptEdits",
      maxTurns: 10,
      resume: sessionId,
    };

    for await (const msg of query({ prompt: analystTask, options: analystOptions })) {
      if (isResult(msg)) {
        console.log(`  [DEBUG] Result subtype: ${msg.subtype}`);
        if (msg.subtype === 'success') {
          console.log(`  [DEBUG] Result length: ${msg.result?.length ?? 0}`);
          todoList = parseJsonFromResult(msg.result);
          if (todoList) {
            console.log(`  ✓ Parsed ${todoList.tasks?.length ?? 0} tasks`);
          }
        }
      }
    }

    // Save TODO
    let todoPath: string | undefined;
    if (todoList && sessionId) {
      todoPath = await saveTodo(sessionId, todoList);
      console.log(`  ✓ TODO saved: ${todoPath}`);
    } else {
      console.log(`  ⚠ No TODO generated`);
    }

    return {
      success: true,
      sessionId,
      todoPath,
      report: todoList,
    };
  } catch (error) {
    console.error('\n[Analyze] Failed:', error);
    return {
      success: false,
      sessionId: sessionId ?? 'unknown',
      error: (error as Error).message,
    };
  }
}

// Parse JSON from various formats
function parseJsonFromResult(result: string): TodoList | undefined {
  try {
    // Pattern 1: ```json\n...\n```
    let match = result.match(/```json\n([\s\S]*?)\n```/);

    // Pattern 2: ```json...``` (no newlines)
    if (!match) {
      match = result.match(/```json([\s\S]*?)```/);
    }

    // Pattern 3: Raw JSON with "tasks"
    if (!match) {
      const rawMatch = result.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
      if (rawMatch) {
        match = ['', rawMatch[0]];
      }
    }

    if (match && match[1]) {
      return JSON.parse(match[1].trim()) as TodoList;
    }

    console.log(`  [DEBUG] No JSON pattern matched`);
    console.log(`  [DEBUG] Result preview: ${result.slice(0, 300)}...`);
    return undefined;
  } catch (e) {
    console.error(`  ⚠ Failed to parse JSON: ${(e as Error).message}`);
    console.log(`  [DEBUG] Result preview: ${result.slice(0, 300)}...`);
    return undefined;
  }
}

// Type guards
function isSystemInit(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init';
}

function isResult(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}
