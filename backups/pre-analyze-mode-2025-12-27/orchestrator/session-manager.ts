/**
 * Session Manager
 * Handles persistent session context across agent invocations
 *
 * Key Features:
 * - 200K token conversation history (vs 10-entry limit in run_state)
 * - Automatic context preservation between handoffs
 * - Fix attempts tracking for GATE 4
 * - MCP call logging for GATE 5
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  SessionContext,
  ConversationEntry,
  FixAttempt,
  MCPCall,
  AgentRole,
  AgentResult,
  Stage,
} from '../types.js';

const getSessionDir = () => process.env.SESSION_STORAGE_PATH || './sessions';
const MAX_HISTORY_TOKENS = 200000;

export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();

  /**
   * Create new session
   */
  async createSession(workflowId?: string): Promise<SessionContext> {
    const id = this.generateSessionId();
    const session: SessionContext = {
      id,
      workflowId,
      stage: 'clarification',
      cycle: 0,
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      history: [],
      fixAttempts: [],
      mcpCalls: [],
      agentResults: new Map(),
    };

    this.sessions.set(id, session);
    await this.persistSession(session);
    return session;
  }

  /**
   * Load existing session
   */
  async loadSession(sessionId: string): Promise<SessionContext | null> {
    // Check memory first
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // Load from disk
    try {
      const filePath = path.join(getSessionDir(), `${sessionId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);

      // Reconstruct Map from plain object
      const session: SessionContext = {
        ...parsed,
        startedAt: new Date(parsed.startedAt),
        lastUpdatedAt: new Date(parsed.lastUpdatedAt),
        history: parsed.history.map((h: ConversationEntry) => ({
          ...h,
          timestamp: new Date(h.timestamp),
        })),
        fixAttempts: parsed.fixAttempts.map((f: FixAttempt) => ({
          ...f,
          timestamp: new Date(f.timestamp),
        })),
        mcpCalls: parsed.mcpCalls.map((m: MCPCall) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        })),
        agentResults: new Map(Object.entries(parsed.agentResults || {})),
      };

      this.sessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Update session stage
   */
  async updateStage(sessionId: string, stage: Stage): Promise<void> {
    const session = await this.getSession(sessionId);
    session.stage = stage;
    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Increment QA cycle
   */
  async incrementCycle(sessionId: string): Promise<number> {
    const session = await this.getSession(sessionId);
    session.cycle += 1;
    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
    return session.cycle;
  }

  /**
   * Add conversation entry
   * Maintains history within token limit
   */
  async addHistory(
    sessionId: string,
    entry: Omit<ConversationEntry, 'timestamp'>
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    const fullEntry: ConversationEntry = {
      ...entry,
      timestamp: new Date(),
    };

    session.history.push(fullEntry);

    // Trim history if exceeds token limit
    await this.trimHistory(session);

    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Get conversation history for agent
   */
  async getHistory(sessionId: string, agentRole?: AgentRole): Promise<ConversationEntry[]> {
    const session = await this.getSession(sessionId);

    if (agentRole) {
      return session.history.filter(
        h => h.agentRole === agentRole || h.role === 'user'
      );
    }

    return session.history;
  }

  /**
   * Log fix attempt (GATE 4)
   */
  async logFixAttempt(
    sessionId: string,
    attempt: Omit<FixAttempt, 'timestamp'>
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    session.fixAttempts.push({
      ...attempt,
      timestamp: new Date(),
    });

    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Get fix attempts for ALREADY_TRIED injection
   */
  async getFixAttempts(sessionId: string): Promise<FixAttempt[]> {
    const session = await this.getSession(sessionId);
    return session.fixAttempts;
  }

  /**
   * Format fix attempts as ALREADY_TRIED section
   */
  async formatAlreadyTried(sessionId: string): Promise<string> {
    const attempts = await this.getFixAttempts(sessionId);

    if (attempts.length === 0) {
      return '';
    }

    let section = '## ALREADY TRIED (DO NOT REPEAT!)\n\n';

    for (const attempt of attempts) {
      section += `### Cycle ${attempt.cycle}: ${attempt.approach}\n`;
      section += `- Result: ${attempt.result}\n`;
      if (attempt.errorType) {
        section += `- Error: ${attempt.errorType}\n`;
      }
      section += `- Nodes: ${attempt.nodesAffected.join(', ')}\n\n`;
    }

    return section;
  }

  /**
   * Log MCP call (GATE 5)
   */
  async logMCPCall(
    sessionId: string,
    call: Omit<MCPCall, 'timestamp'>
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    session.mcpCalls.push({
      ...call,
      timestamp: new Date(),
    });

    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Get MCP calls for verification
   */
  async getMCPCalls(sessionId: string, agentRole?: AgentRole): Promise<MCPCall[]> {
    const session = await this.getSession(sessionId);

    if (agentRole) {
      return session.mcpCalls.filter(c => c.agentRole === agentRole);
    }

    return session.mcpCalls;
  }

  /**
   * Store agent result
   */
  async storeAgentResult(
    sessionId: string,
    result: AgentResult
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    session.agentResults.set(result.agentRole, result);
    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Get agent result
   */
  async getAgentResult(
    sessionId: string,
    agentRole: AgentRole
  ): Promise<AgentResult | undefined> {
    const session = await this.getSession(sessionId);
    return session.agentResults.get(agentRole);
  }

  /**
   * Set workflow ID
   */
  async setWorkflowId(sessionId: string, workflowId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    session.workflowId = workflowId;
    session.lastUpdatedAt = new Date();
    await this.persistSession(session);
  }

  /**
   * Get full session
   */
  private async getSession(sessionId: string): Promise<SessionContext> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = await this.loadSession(sessionId) ?? undefined;
    }

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session;
  }

  /**
   * Trim history to stay within token limit
   */
  private async trimHistory(session: SessionContext): Promise<void> {
    let totalTokens = this.estimateTokens(session.history);

    while (totalTokens > MAX_HISTORY_TOKENS && session.history.length > 10) {
      // Keep first entry (usually important context)
      // Remove oldest entries after first
      session.history.splice(1, 1);
      totalTokens = this.estimateTokens(session.history);
    }
  }

  /**
   * Estimate tokens in history
   */
  private estimateTokens(history: ConversationEntry[]): number {
    return history.reduce((sum, entry) => {
      return sum + (entry.tokens || Math.ceil(entry.content.length / 4));
    }, 0);
  }

  /**
   * Persist session to disk
   */
  private async persistSession(session: SessionContext): Promise<void> {
    const sessionDir = getSessionDir();
    await fs.mkdir(sessionDir, { recursive: true });

    const filePath = path.join(sessionDir, `${session.id}.json`);

    // Convert Map to plain object for JSON
    const serializable = {
      ...session,
      agentResults: Object.fromEntries(session.agentResults),
    };

    await fs.writeFile(filePath, JSON.stringify(serializable, null, 2));
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Archive completed session
   */
  async archiveSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    const archiveDir = path.join(getSessionDir(), 'archives');
    await fs.mkdir(archiveDir, { recursive: true });

    const archivePath = path.join(archiveDir, `${sessionId}_complete.json`);
    const serializable = {
      ...session,
      agentResults: Object.fromEntries(session.agentResults),
    };

    await fs.writeFile(archivePath, JSON.stringify(serializable, null, 2));

    // Remove from active sessions
    const activePath = path.join(getSessionDir(), `${sessionId}.json`);
    await fs.unlink(activePath).catch(() => {});
    this.sessions.delete(sessionId);
  }
}

export const sessionManager = new SessionManager();
