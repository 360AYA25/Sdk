/**
 * Inter-Agent Message Protocol
 *
 * Enables agents to ask questions and get answers from other agents.
 * Uses async message queue pattern for decoupling.
 *
 * Based on structured multi-agent communication protocols research.
 */

import crypto from 'crypto';
import type {
  AgentMessage,
  AgentRole,
  MessageType,
  MessagePriority,
  QAExchange,
} from '../types.js';
import type { SharedContextStore } from './context-store.js';

/**
 * Handler interface for agents to implement
 */
export interface MessageHandler {
  handleMessage(message: AgentMessage): Promise<string>;
}

/**
 * MessageCoordinator
 *
 * Routes messages between agents and manages Q&A flow.
 */
export class MessageCoordinator {
  private store: SharedContextStore;
  private handlers: Map<AgentRole, MessageHandler>;
  private qaExchanges: QAExchange[];

  constructor(store: SharedContextStore) {
    this.store = store;
    this.handlers = new Map();
    this.qaExchanges = [];
  }

  /**
   * Register an agent's message handler
   */
  registerHandler(role: AgentRole, handler: MessageHandler): void {
    this.handlers.set(role, handler);
    console.log(`[MessageCoordinator] Registered handler for ${role}`);
  }

  /**
   * Unregister handler
   */
  unregisterHandler(role: AgentRole): void {
    this.handlers.delete(role);
  }

  /**
   * Send a question to another agent
   */
  async askQuestion(
    from: AgentRole,
    to: AgentRole,
    question: string,
    context?: Record<string, unknown>,
    priority: MessagePriority = 'high'
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      type: 'question',
      priority,
      from,
      to,
      subject: `Question from ${from}`,
      content: question,
      context,
      expectedResponseType: 'text',
      timestamp: new Date(),
      status: 'pending',
      retryCount: 0,
    };

    // Add to store's queue
    this.store.addMessage(message);

    console.log(`[Q&A] ${from} -> ${to}: "${question.slice(0, 50)}..."`);

    // Wait for answer (with timeout)
    return this.waitForAnswer(message.id, 60000);
  }

  /**
   * Send notification to agent (no response expected)
   */
  notify(
    from: AgentRole,
    to: AgentRole | 'all',
    subject: string,
    content: string
  ): void {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      type: 'notify',
      priority: 'normal',
      from,
      to,
      subject,
      content,
      timestamp: new Date(),
      status: 'resolved', // Notifications are immediately resolved
      retryCount: 0,
    };

    this.store.addMessage(message);
  }

  /**
   * Process all pending messages
   */
  async processPendingMessages(): Promise<number> {
    const queue = this.store.get('messageQueue');
    const pending = queue.filter(m => m.status === 'pending' && m.type === 'question');

    let processed = 0;

    for (const message of pending) {
      const handler = this.handlers.get(message.to as AgentRole);

      if (!handler) {
        console.warn(`[Q&A] No handler for ${message.to}, skipping message ${message.id}`);
        continue;
      }

      message.status = 'processing';

      try {
        console.log(`[Q&A] Processing question from ${message.from} to ${message.to}`);
        const answerContent = await handler.handleMessage(message);

        // Create answer message
        const answer: AgentMessage = {
          id: crypto.randomUUID(),
          type: 'answer',
          priority: message.priority,
          from: message.to as AgentRole,
          to: message.from,
          subject: `Answer to: ${message.subject}`,
          content: answerContent,
          inResponseTo: message.id,
          timestamp: new Date(),
          status: 'resolved',
          retryCount: 0,
        };

        // Record Q&A exchange
        this.qaExchanges.push({
          from: message.from,
          to: message.to as AgentRole,
          question: message.content,
          answer: answerContent,
          timestamp: new Date(),
        });

        this.store.resolveMessage(message.id, answer);
        processed++;

        console.log(`[Q&A] Answer received from ${message.to}`);
      } catch (error) {
        message.retryCount++;

        if (message.retryCount >= 3) {
          message.status = 'timeout';
          console.error(`[Q&A] Message ${message.id} timed out after 3 retries`);
        } else {
          message.status = 'pending';
          console.warn(`[Q&A] Retry ${message.retryCount}/3 for message ${message.id}`);
        }
      }
    }

    return processed;
  }

  /**
   * Wait for answer to specific message
   */
  private async waitForAnswer(
    messageId: string,
    timeout: number
  ): Promise<AgentMessage> {
    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeout) {
      const resolved = this.store.get('resolvedMessages');
      const answer = resolved.find(m => m.inResponseTo === messageId);

      if (answer) {
        return answer;
      }

      // Also check if message was timed out
      const queue = this.store.get('messageQueue');
      const original = queue.find(m => m.id === messageId);
      if (original?.status === 'timeout') {
        throw new Error(`Message ${messageId} timed out`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for answer to message ${messageId}`);
  }

  /**
   * Get all Q&A exchanges (for report)
   */
  getQAExchanges(): QAExchange[] {
    return [...this.qaExchanges];
  }

  /**
   * Get pending question count
   */
  getPendingCount(): number {
    const queue = this.store.get('messageQueue');
    return queue.filter(m => m.status === 'pending' && m.type === 'question').length;
  }

  /**
   * Check if there are pending messages
   */
  hasPendingMessages(): boolean {
    return this.getPendingCount() > 0;
  }

  /**
   * Clear all handlers (for cleanup)
   */
  clearHandlers(): void {
    this.handlers.clear();
  }

  /**
   * Create handler from function
   */
  static createHandler(
    fn: (message: AgentMessage) => Promise<string>
  ): MessageHandler {
    return { handleMessage: fn };
  }
}

/**
 * Helper to create a question context
 */
export function createQuestionContext(
  nodeInfo?: { name: string; type: string },
  findings?: string[],
  additionalContext?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(nodeInfo && { node: nodeInfo }),
    ...(findings && { findings }),
    ...additionalContext,
  };
}
