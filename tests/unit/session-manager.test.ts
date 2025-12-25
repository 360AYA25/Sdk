/**
 * Unit Tests: SessionManager
 * Tests for session persistence, history management, and GATE 4/5 support
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionManager } from '../../src/orchestrator/session-manager.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { SessionContext, FixAttempt, MCPCall } from '../../src/types.js';

const TEST_SESSION_DIR = './tests/fixtures/sessions';

describe('SessionManager', () => {
  let testSessionId: string;

  beforeEach(async () => {
    // Set test session directory
    process.env.SESSION_STORAGE_PATH = TEST_SESSION_DIR;
    await fs.mkdir(TEST_SESSION_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test sessions
    try {
      await fs.rm(TEST_SESSION_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('Session Creation', () => {
    it('should create a new session', async () => {
      const session = await sessionManager.createSession();

      expect(session.id).toBeDefined();
      expect(session.stage).toBe('clarification');
      expect(session.cycle).toBe(0);
      expect(session.history).toEqual([]);
      expect(session.fixAttempts).toEqual([]);
      expect(session.mcpCalls).toEqual([]);
    });

    it('should create session with workflow ID', async () => {
      const workflowId = 'test-workflow-123';
      const session = await sessionManager.createSession(workflowId);

      expect(session.workflowId).toBe(workflowId);
    });

    it('should persist session to disk', async () => {
      const session = await sessionManager.createSession();
      const sessionPath = path.join(TEST_SESSION_DIR, `${session.id}.json`);

      const exists = await fs.access(sessionPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('Session Loading', () => {
    it('should load existing session from disk', async () => {
      const session = await sessionManager.createSession('test-workflow');
      const sessionId = session.id;

      const loaded = await sessionManager.loadSession(sessionId);

      expect(loaded).toBeDefined();
      expect(loaded!.id).toBe(sessionId);
      expect(loaded!.workflowId).toBe('test-workflow');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await sessionManager.loadSession('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('Stage Management', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should update session stage', async () => {
      await sessionManager.updateStage(testSessionId, 'research');
      const session = await sessionManager.loadSession(testSessionId);

      expect(session!.stage).toBe('research');
    });
  });

  describe('Cycle Management', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should increment QA cycle', async () => {
      const cycle1 = await sessionManager.incrementCycle(testSessionId);
      expect(cycle1).toBe(1);

      const cycle2 = await sessionManager.incrementCycle(testSessionId);
      expect(cycle2).toBe(2);
    });
  });

  describe('Conversation History', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should add conversation entry', async () => {
      await sessionManager.addHistory(testSessionId, {
        role: 'user',
        content: 'Create a Telegram bot',
      });

      const history = await sessionManager.getHistory(testSessionId);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Create a Telegram bot');
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should filter history by agent role', async () => {
      await sessionManager.addHistory(testSessionId, {
        role: 'assistant',
        content: 'Architect response',
        agentRole: 'architect',
      });

      await sessionManager.addHistory(testSessionId, {
        role: 'assistant',
        content: 'Researcher response',
        agentRole: 'researcher',
      });

      const architectHistory = await sessionManager.getHistory(testSessionId, 'architect');
      expect(architectHistory).toHaveLength(1);
      expect(architectHistory[0].agentRole).toBe('architect');
    });

    it('should maintain 200K token limit', async () => {
      // Add many large entries
      for (let i = 0; i < 100; i++) {
        await sessionManager.addHistory(testSessionId, {
          role: 'assistant',
          content: 'X'.repeat(10000), // ~2500 tokens
          tokens: 2500,
        });
      }

      const history = await sessionManager.getHistory(testSessionId);
      const totalTokens = history.reduce((sum, entry) => sum + (entry.tokens || 0), 0);

      expect(totalTokens).toBeLessThanOrEqual(200000);
    });
  });

  describe('GATE 4: Fix Attempts Tracking', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should log fix attempt', async () => {
      const attempt: Omit<FixAttempt, 'timestamp'> = {
        cycle: 1,
        approach: 'Fix webhook configuration',
        result: 'failed',
        errorType: 'validation',
        nodesAffected: ['Webhook', 'Telegram'],
      };

      await sessionManager.logFixAttempt(testSessionId, attempt);

      const attempts = await sessionManager.getFixAttempts(testSessionId);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].approach).toBe('Fix webhook configuration');
    });

    it('should format ALREADY_TRIED section', async () => {
      await sessionManager.logFixAttempt(testSessionId, {
        cycle: 1,
        approach: 'Change webhook path',
        result: 'failed',
        nodesAffected: ['Webhook'],
      });

      await sessionManager.logFixAttempt(testSessionId, {
        cycle: 2,
        approach: 'Update Telegram credentials',
        result: 'failed',
        errorType: 'auth',
        nodesAffected: ['Telegram'],
      });

      const formatted = await sessionManager.formatAlreadyTried(testSessionId);

      expect(formatted).toContain('ALREADY TRIED');
      expect(formatted).toContain('Cycle 1');
      expect(formatted).toContain('Cycle 2');
      expect(formatted).toContain('Change webhook path');
      expect(formatted).toContain('Update Telegram credentials');
    });

    it('should return empty string when no attempts', async () => {
      const formatted = await sessionManager.formatAlreadyTried(testSessionId);
      expect(formatted).toBe('');
    });
  });

  describe('GATE 5: MCP Call Logging', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should log MCP call', async () => {
      const call: Omit<MCPCall, 'timestamp'> = {
        tool: 'mcp__n8n-mcp__n8n_create_workflow',
        type: 'mutation',
        params: { name: 'Test Workflow' },
        agentRole: 'builder',
      };

      await sessionManager.logMCPCall(testSessionId, call);

      const calls = await sessionManager.getMCPCalls(testSessionId);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toContain('create_workflow');
      expect(calls[0].type).toBe('mutation');
    });

    it('should filter MCP calls by agent', async () => {
      await sessionManager.logMCPCall(testSessionId, {
        tool: 'mcp__n8n-mcp__search_nodes',
        type: 'search',
        params: {},
        agentRole: 'researcher',
      });

      await sessionManager.logMCPCall(testSessionId, {
        tool: 'mcp__n8n-mcp__n8n_create_workflow',
        type: 'mutation',
        params: {},
        agentRole: 'builder',
      });

      const builderCalls = await sessionManager.getMCPCalls(testSessionId, 'builder');
      expect(builderCalls).toHaveLength(1);
      expect(builderCalls[0].agentRole).toBe('builder');
    });
  });

  describe('Agent Results Storage', () => {
    beforeEach(async () => {
      const session = await sessionManager.createSession();
      testSessionId = session.id;
    });

    it('should store and retrieve agent result', async () => {
      const result = {
        agentRole: 'architect' as const,
        success: true,
        data: { workflow_name: 'Test' },
        mcpCalls: [],
        timestamp: new Date(),
      };

      await sessionManager.storeAgentResult(testSessionId, result);

      const retrieved = await sessionManager.getAgentResult(testSessionId, 'architect');
      expect(retrieved).toBeDefined();
      expect(retrieved!.success).toBe(true);
    });
  });

  describe('Session Archival', () => {
    it('should archive completed session', async () => {
      const session = await sessionManager.createSession();
      await sessionManager.archiveSession(session.id);

      const archivePath = path.join(TEST_SESSION_DIR, 'archives', `${session.id}_complete.json`);
      const exists = await fs.access(archivePath).then(() => true).catch(() => false);

      expect(exists).toBe(true);

      // Original should be deleted
      const originalPath = path.join(TEST_SESSION_DIR, `${session.id}.json`);
      const originalExists = await fs.access(originalPath).then(() => true).catch(() => false);

      expect(originalExists).toBe(false);
    });
  });
});
