/**
 * Shared Context Store
 *
 * Central store for all analysis data, accessible by all agents.
 * Based on Google ADK pattern: "all agents access same session.state"
 *
 * Key principle: Use distinct keys to avoid race conditions
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  SharedContext,
  ProjectDocs,
  WorkflowData,
  NodeSchema,
  ExecutionHistory,
  DatabaseSchema,
  ArchitectAnalysis,
  ResearcherAnalysisFindings,
  AnalysisReport,
  AgentMessage,
  AnalysisStatus,
  AgentRole,
} from '../types.js';

// Project paths
const PROJECT_ROOT = process.cwd();
const SESSIONS_DIR = path.join(PROJECT_ROOT, 'sessions', 'analyze');

// Write permission mapping
const WRITE_PERMISSIONS: Record<string, AgentRole | 'orchestrator'> = {
  // Orchestrator can write raw data
  projectDocs: 'orchestrator',
  workflowData: 'orchestrator',
  nodeSchemas: 'orchestrator',
  executionHistory: 'orchestrator',
  supabaseSchema: 'orchestrator',
  status: 'orchestrator',

  // Each agent writes their own contribution
  architectContext: 'architect',
  researcherFindings: 'researcher',
  analystReport: 'analyst',

  // Message queue managed by coordinator (part of orchestrator)
  messageQueue: 'orchestrator',
  resolvedMessages: 'orchestrator',
};

export class SharedContextStore {
  private context: SharedContext;
  private subscribers: Map<string, (context: SharedContext) => void>;

  constructor(workflowId: string) {
    this.context = this.initializeContext(workflowId);
    this.subscribers = new Map();
  }

  /**
   * Initialize empty context
   */
  private initializeContext(workflowId: string): SharedContext {
    return {
      // Raw data (to be loaded)
      projectDocs: {
        readme: null,
        todo: null,
        plan: null,
        architecture: null,
        contextFiles: {},
      },
      workflowData: {
        id: workflowId,
        name: '',
        active: false,
        nodes: [],
        connections: {},
        settings: {},
      },
      nodeSchemas: {},
      executionHistory: {
        total: 0,
        successRate: 0,
        recentExecutions: [],
        errorPatterns: [],
      },
      supabaseSchema: undefined,

      // Agent contributions
      architectContext: null,
      researcherFindings: null,
      analystReport: null,

      // Message queue
      messageQueue: [],
      resolvedMessages: [],

      // Metadata
      analysisId: `analysis_${crypto.randomUUID().slice(0, 8)}`,
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      status: 'loading',
    };
  }

  /**
   * Read operations (any agent)
   */
  get<K extends keyof SharedContext>(key: K): SharedContext[K] {
    return this.context[key];
  }

  /**
   * Get full context (read-only snapshot)
   */
  getSnapshot(): Readonly<SharedContext> {
    return { ...this.context };
  }

  /**
   * Write operations (specific agent with permission check)
   */
  set<K extends keyof SharedContext>(
    key: K,
    value: SharedContext[K],
    agentRole: AgentRole | 'orchestrator'
  ): void {
    // Validate write permission
    this.validateWritePermission(key, agentRole);

    this.context[key] = value;
    this.context.lastUpdatedAt = new Date();

    // Notify subscribers
    this.notifySubscribers();

    // Auto-persist (fire and forget)
    this.persist().catch(err => {
      console.warn('[ContextStore] Persist warning:', err.message);
    });
  }

  /**
   * Validate agent has permission to write to key
   */
  private validateWritePermission(
    key: keyof SharedContext,
    agentRole: AgentRole | 'orchestrator'
  ): void {
    const allowedRole = WRITE_PERMISSIONS[key as string];

    if (allowedRole && allowedRole !== agentRole) {
      throw new Error(
        `Agent '${agentRole}' does not have write permission for '${key}'. ` +
          `Only '${allowedRole}' can write to this key.`
      );
    }
  }

  /**
   * Subscribe to context changes
   */
  subscribe(id: string, callback: (context: SharedContext) => void): void {
    this.subscribers.set(id, callback);
  }

  /**
   * Unsubscribe from changes
   */
  unsubscribe(id: string): void {
    this.subscribers.delete(id);
  }

  /**
   * Notify all subscribers
   */
  private notifySubscribers(): void {
    for (const callback of this.subscribers.values()) {
      try {
        callback(this.context);
      } catch (err) {
        console.warn('[ContextStore] Subscriber error:', err);
      }
    }
  }

  /**
   * Persist context to file
   */
  async persist(): Promise<void> {
    try {
      await fs.mkdir(SESSIONS_DIR, { recursive: true });

      const filePath = path.join(SESSIONS_DIR, `${this.context.analysisId}.json`);

      // Convert dates to ISO strings for JSON
      const serializable = JSON.stringify(
        this.context,
        (_, value) => {
          if (value instanceof Date) {
            return value.toISOString();
          }
          return value;
        },
        2
      );

      await fs.writeFile(filePath, serializable);
    } catch (err) {
      console.warn('[ContextStore] Failed to persist:', err);
    }
  }

  /**
   * Load context from file
   */
  static async load(analysisId: string): Promise<SharedContextStore> {
    const filePath = path.join(SESSIONS_DIR, `${analysisId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');

    const store = new SharedContextStore('');
    store.context = JSON.parse(data, (key, value) => {
      // Restore dates
      if (
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
      ) {
        return new Date(value);
      }
      return value;
    });

    return store;
  }

  /**
   * Check if analysis exists
   */
  static async exists(analysisId: string): Promise<boolean> {
    const filePath = path.join(SESSIONS_DIR, `${analysisId}.json`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update status with validation
   */
  updateStatus(status: AnalysisStatus): void {
    const validTransitions: Record<AnalysisStatus, AnalysisStatus[]> = {
      loading: ['understanding', 'complete'],
      understanding: ['investigating', 'complete'],
      investigating: ['synthesizing', 'complete'],
      synthesizing: ['complete'],
      complete: [],
    };

    const currentStatus = this.context.status;
    if (!validTransitions[currentStatus].includes(status) && status !== currentStatus) {
      console.warn(
        `[ContextStore] Invalid status transition: ${currentStatus} -> ${status}`
      );
    }

    this.context.status = status;
    this.context.lastUpdatedAt = new Date();
    this.persist().catch(() => {});
  }

  /**
   * Add message to queue
   */
  addMessage(message: AgentMessage): void {
    this.context.messageQueue.push(message);
    this.context.lastUpdatedAt = new Date();
    this.notifySubscribers();
  }

  /**
   * Move message from queue to resolved
   */
  resolveMessage(messageId: string, answer: AgentMessage): void {
    // Find and update message in queue
    const messageIndex = this.context.messageQueue.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
      this.context.messageQueue[messageIndex].status = 'resolved';
    }

    // Add answer to resolved
    this.context.resolvedMessages.push(answer);
    this.context.lastUpdatedAt = new Date();
    this.notifySubscribers();
  }

  /**
   * Get pending messages for an agent
   */
  getPendingMessagesFor(role: AgentRole): AgentMessage[] {
    return this.context.messageQueue.filter(
      m => (m.to === role || m.to === 'all') && m.status === 'pending'
    );
  }

  /**
   * Get summary for logging
   */
  getSummary(): string {
    const { status, analysisId } = this.context;
    const nodeCount = this.context.workflowData.nodes.length;
    const hasArchitect = this.context.architectContext !== null;
    const hasResearcher = this.context.researcherFindings !== null;
    const hasAnalyst = this.context.analystReport !== null;
    const pendingMessages = this.context.messageQueue.filter(
      m => m.status === 'pending'
    ).length;

    return [
      `Analysis: ${analysisId}`,
      `Status: ${status}`,
      `Nodes: ${nodeCount}`,
      `Contributions: [${hasArchitect ? 'A' : '-'}${hasResearcher ? 'R' : '-'}${hasAnalyst ? 'L' : '-'}]`,
      `Pending Q&A: ${pendingMessages}`,
    ].join(' | ');
  }
}
