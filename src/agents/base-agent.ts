/**
 * Base Agent Class
 * Foundation for all 5 agents in the ClaudeN8N system
 *
 * Features:
 * - Claude Agent SDK integration (uses subscription, not API)
 * - MCP tools via n8n-mcp
 * - Session context management
 * - Skill loading
 * - Index-first reading protocol
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { promises as fs } from 'fs';
import path from 'path';
import type {
  AgentRole,
  AgentConfig,
  SessionContext,
  AgentResult,
  MCPCall,
} from '../types.js';
import { sessionManager } from '../orchestrator/session-manager.js';

// Project paths - relative to sdk-migration directory
const PROJECT_ROOT = process.cwd();
const PROMPTS_DIR = path.join(PROJECT_ROOT, 'src', 'shared', 'prompts');
const INDEXES_DIR = path.join(PROJECT_ROOT, 'indexes');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const MCP_CONFIG_PATH = path.join(PROJECT_ROOT, '.mcp.json');

// MCP server config type
interface McpServerConfigStdio {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServerConfigHttp {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

type McpServerConfig = McpServerConfigStdio | McpServerConfigHttp;

// MCP server configuration (loaded once)
let mcpServers: Record<string, McpServerConfig> | undefined;

async function loadMCPConfig(): Promise<Record<string, McpServerConfig> | undefined> {
  if (mcpServers !== undefined) return mcpServers;

  try {
    const content = await fs.readFile(MCP_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);
    mcpServers = (config.mcpServers || {}) as Record<string, McpServerConfig>;
    console.log(`[MCP] Loaded ${Object.keys(mcpServers).length} servers from .mcp.json`);
    return mcpServers;
  } catch {
    console.warn('[MCP] No .mcp.json found, running without MCP servers');
    mcpServers = undefined;
    return undefined;
  }
}

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected role: AgentRole;
  protected instructions: string = '';
  protected indexContent: string = '';

  constructor(role: AgentRole, config: AgentConfig) {
    this.role = role;
    this.config = config;
  }

  /**
   * Initialize agent (load instructions, index, skills)
   */
  async initialize(): Promise<void> {
    await this.loadInstructions();
    await this.loadIndex();
    await this.loadSkills();
  }

  /**
   * Load agent instructions from src/shared/prompts/{role}.md
   */
  protected async loadInstructions(): Promise<void> {
    const promptPath = path.join(PROMPTS_DIR, this.config.promptFile);
    try {
      this.instructions = await fs.readFile(promptPath, 'utf-8');
    } catch (error) {
      console.error(`Failed to load instructions for ${this.role}:`, error);
      throw new Error(`Agent instructions not found: ${promptPath}`);
    }
  }

  /**
   * Load agent-scoped index (97% token savings)
   */
  protected async loadIndex(): Promise<void> {
    const indexPath = path.join(INDEXES_DIR, this.config.indexFile);
    try {
      this.indexContent = await fs.readFile(indexPath, 'utf-8');
    } catch {
      console.warn(`Index not found for ${this.role}: ${indexPath}`);
      this.indexContent = '';
    }
  }

  /**
   * Load skills content
   */
  protected async loadSkills(): Promise<string> {
    const skillContents: string[] = [];

    for (const skill of this.config.skills) {
      const skillPath = path.join(SKILLS_DIR, skill, 'SKILL.md');
      try {
        const content = await fs.readFile(skillPath, 'utf-8');
        skillContents.push(`## Skill: ${skill}\n${content}`);
      } catch {
        console.warn(`Skill not found: ${skill} (${skillPath})`);
      }
    }

    return skillContents.join('\n\n---\n\n');
  }

  /**
   * Build system prompt with instructions, index, and skills
   */
  protected async buildSystemPrompt(session: SessionContext): Promise<string> {
    const skills = await this.loadSkills();

    return `${this.instructions}

---

## AGENT-SCOPED INDEX

${this.indexContent}

---

## SKILLS

${skills}

---

## SESSION CONTEXT

- Session ID: ${session.id}
- Stage: ${session.stage}
- Cycle: ${session.cycle}
- Workflow ID: ${session.workflowId || 'none'}
`;
  }

  /**
   * Execute agent task using Claude Agent SDK with timeout
   * Uses your Claude subscription (no API costs!)
   */
  async invoke(
    session: SessionContext,
    task: string,
    context?: Record<string, unknown>
  ): Promise<AgentResult> {
    // Wrap in timeout to prevent Agent SDK from hanging
    const TIMEOUT_MS = 90000; // 90 seconds

    const timeoutPromise = new Promise<AgentResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent ${this.role} timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);
    });

    const invokePromise = this.invokeWithoutTimeout(session, task, context);

    return Promise.race([invokePromise, timeoutPromise]);
  }

  /**
   * Internal invoke implementation without timeout
   */
  private async invokeWithoutTimeout(
    session: SessionContext,
    task: string,
    context?: Record<string, unknown>
  ): Promise<AgentResult> {
    const mcpCalls: MCPCall[] = [];

    try {
      // Build full prompt
      const systemPrompt = await this.buildSystemPrompt(session);
      const taskPrompt = this.buildTaskPrompt(task, context);

      const fullPrompt = `${systemPrompt}

---

${taskPrompt}`;

      console.log(`[${this.role}] Invoking with Agent SDK...`);

      // Load MCP servers
      const servers = await loadMCPConfig();

      let result = '';

      // Use Claude Agent SDK query()
      for await (const message of query({
        prompt: fullPrompt,
        options: {
          model: this.config.model,
          maxTurns: 30, // Increased for complex workflows
          mcpServers: servers,
          // If mcpTools is empty array, pass empty array (no tools)
          // If mcpTools has items, pass those specific tools
          // If mcpTools is undefined, allow all tools
          allowedTools: this.config.mcpTools,
        },
      })) {
        // Handle result message
        if (message.type === 'result' && 'result' in message) {
          result = message.result;
          console.log(`[${this.role}] Got final result`);
        }
        // Handle assistant message (contains tool calls)
        else if (message.type === 'assistant' && 'message' in message) {
          const msg = message.message as { content?: unknown[] };
          if (msg?.content && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              const b = block as { type: string; name?: string; input?: unknown };
              if (b.type === 'tool_use' && b.name) {
                console.log(`[${this.role}] Tool: ${b.name}`);
                mcpCalls.push({
                  tool: b.name,
                  type: this.getToolType(b.name),
                  params: (b.input as Record<string, unknown>) || {},
                  timestamp: new Date(),
                  agentRole: this.role,
                });
              }
            }
          }
        }
      }

      // Log all MCP calls
      for (const call of mcpCalls) {
        await sessionManager.logMCPCall(session.id, call);
      }

      // Debug: show raw result
      console.log(`[${this.role}] Raw result (first 500 chars): ${result.slice(0, 500)}`);

      // Process result
      const processedResult = await this.processResult(result, session, mcpCalls);

      // Log to session
      await sessionManager.addHistory(session.id, {
        role: 'assistant',
        content: result,
        agentRole: this.role,
      });

      // Store result
      const agentResult: AgentResult = {
        agentRole: this.role,
        success: true,
        data: processedResult,
        mcpCalls,
        timestamp: new Date(),
      };

      await sessionManager.storeAgentResult(session.id, agentResult);

      return agentResult;
    } catch (error) {
      console.error(`Agent ${this.role} failed:`, error);

      return {
        agentRole: this.role,
        success: false,
        data: { error: (error as Error).message },
        mcpCalls,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Determine tool type for GATE 5
   */
  protected getToolType(toolName: string): 'read' | 'mutation' | 'search' {
    const name = toolName.toLowerCase();

    if (name.includes('create') || name.includes('update') || name.includes('delete') || name.includes('autofix')) {
      return 'mutation';
    }
    if (name.includes('search') || name.includes('list')) {
      return 'search';
    }
    return 'read';
  }

  /**
   * Build task prompt with context
   */
  protected buildTaskPrompt(
    task: string,
    context?: Record<string, unknown>
  ): string {
    let prompt = `## TASK\n\n${task}`;

    if (context) {
      prompt += '\n\n## CONTEXT\n\n';
      for (const [key, value] of Object.entries(context)) {
        prompt += `### ${key}\n${JSON.stringify(value, null, 2)}\n\n`;
      }
    }

    return prompt;
  }

  /**
   * Process result (abstract - implement per agent)
   */
  protected abstract processResult(
    result: string,
    session: SessionContext,
    mcpCalls: MCPCall[]
  ): Promise<unknown>;

  /**
   * Get agent role
   */
  getRole(): AgentRole {
    return this.role;
  }

  /**
   * Get agent model
   */
  getModel(): string {
    return this.config.model;
  }
}
