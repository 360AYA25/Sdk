/**
 * Unit Tests: GateEnforcer
 * Tests for all 6 validation gates
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { gateEnforcer } from '../../src/orchestrator/gate-enforcer.js';
import type {
  SessionContext,
  QAReport,
  ResearchFindings,
  ValidationError,
} from '../../src/types.js';

describe('GateEnforcer', () => {
  let mockSession: SessionContext;

  beforeEach(() => {
    mockSession = {
      id: 'test-session',
      stage: 'build',
      cycle: 1,
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      history: [],
      fixAttempts: [],
      mcpCalls: [],
      agentResults: new Map(),
    };

    gateEnforcer.clearViolations();
  });

  describe('GATE 1: Progressive Escalation', () => {
    it('should pass for cycle 1-3 with Builder', async () => {
      mockSession.cycle = 2;
      const result = await gateEnforcer.checkProgressiveEscalation(mockSession, 'builder');

      expect(result.passed).toBe(true);
      expect(result.gate).toBe('GATE_1');
    });

    it('should block Builder at cycle 4+ without Researcher', async () => {
      mockSession.cycle = 4;
      const result = await gateEnforcer.checkProgressiveEscalation(mockSession, 'builder');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('requires Researcher');
      expect(result.data).toHaveProperty('requireAgent', 'researcher');
    });

    it('should allow Builder at cycle 4+ with recent Researcher result', async () => {
      mockSession.cycle = 4;
      mockSession.agentResults.set('researcher', {
        agentRole: 'researcher',
        success: true,
        data: {},
        mcpCalls: [],
        timestamp: new Date(), // Recent
      });

      const result = await gateEnforcer.checkProgressiveEscalation(mockSession, 'builder');

      expect(result.passed).toBe(true);
    });

    it('should block all agents at cycle 8+', async () => {
      mockSession.cycle = 8;
      const result = await gateEnforcer.checkProgressiveEscalation(mockSession, 'builder');

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Maximum 7 cycles exceeded');
      expect(result.data).toHaveProperty('escalation', 'L4');
      expect(result.data).toHaveProperty('triggerAnalyst', true);
    });

    it('should determine correct escalation level', () => {
      expect(gateEnforcer.getEscalationLevel(1).level).toBe('L1');
      expect(gateEnforcer.getEscalationLevel(3).level).toBe('L1');
      expect(gateEnforcer.getEscalationLevel(4).level).toBe('L2');
      expect(gateEnforcer.getEscalationLevel(5).level).toBe('L2');
      expect(gateEnforcer.getEscalationLevel(6).level).toBe('L3');
      expect(gateEnforcer.getEscalationLevel(7).level).toBe('L3');
      expect(gateEnforcer.getEscalationLevel(8).level).toBe('L4');
    });
  });

  describe('GATE 2: Execution Analysis Requirement', () => {
    it('should pass when no failed execution', async () => {
      const result = await gateEnforcer.checkExecutionAnalysis(mockSession, false);

      expect(result.passed).toBe(true);
      expect(result.gate).toBe('GATE_2');
    });

    it('should block without execution analysis', async () => {
      const result = await gateEnforcer.checkExecutionAnalysis(mockSession, true);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('L-067');
    });

    it('should block with unvalidated hypothesis', async () => {
      mockSession.agentResults.set('researcher', {
        agentRole: 'researcher',
        success: true,
        data: {
          hypothesis: 'Test hypothesis',
          hypothesis_validated: false,
          fit_score: 0.8,
          templates_found: [],
          nodes_found: [],
          existing_workflows: [],
        } as ResearchFindings,
        mcpCalls: [],
        timestamp: new Date(),
      });

      // Mock L-067 compliance
      mockSession.mcpCalls = [
        {
          tool: 'mcp__n8n-mcp__n8n_executions',
          type: 'read',
          params: { mode: 'summary' },
          agentRole: 'researcher',
          timestamp: new Date(),
        },
        {
          tool: 'mcp__n8n-mcp__n8n_executions',
          type: 'read',
          params: { mode: 'filtered' },
          agentRole: 'researcher',
          timestamp: new Date(),
        },
      ];

      const result = await gateEnforcer.checkExecutionAnalysis(mockSession, true);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Hypothesis not validated');
    });

    it('should pass with validated hypothesis and L-067 compliance', async () => {
      mockSession.agentResults.set('researcher', {
        agentRole: 'researcher',
        success: true,
        data: {
          hypothesis: 'Test hypothesis',
          hypothesis_validated: true,
          fit_score: 0.8,
          templates_found: [],
          nodes_found: [],
          existing_workflows: [],
        } as ResearchFindings,
        mcpCalls: [],
        timestamp: new Date(),
      });

      // Mock L-067 compliance
      mockSession.mcpCalls = [
        {
          tool: 'mcp__n8n-mcp__n8n_executions',
          type: 'read',
          params: { mode: 'summary' },
          agentRole: 'researcher',
          timestamp: new Date(),
        },
        {
          tool: 'mcp__n8n-mcp__n8n_executions',
          type: 'read',
          params: { mode: 'filtered' },
          agentRole: 'researcher',
          timestamp: new Date(),
        },
      ];

      const result = await gateEnforcer.checkExecutionAnalysis(mockSession, true);

      expect(result.passed).toBe(true);
    });
  });

  describe('GATE 3: Phase 5 Real Testing', () => {
    it('should pass for non-PASS status', async () => {
      const qaReport: QAReport = {
        status: 'FAIL',
        phase_5_executed: false,
        errors: [],
        warnings: [],
        edit_scope: [],
        regression_detected: false,
      };

      const result = await gateEnforcer.checkPhase5Testing(qaReport);

      expect(result.passed).toBe(true);
    });

    it('should block PASS without Phase 5', async () => {
      const qaReport: QAReport = {
        status: 'PASS',
        phase_5_executed: false,
        errors: [],
        warnings: [],
        edit_scope: [],
        regression_detected: false,
      };

      const result = await gateEnforcer.checkPhase5Testing(qaReport);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Phase 5 real workflow testing');
      expect(result.data).toHaveProperty('requirement', 'phase_5_executed: true');
    });

    it('should pass PASS with Phase 5 executed', async () => {
      const qaReport: QAReport = {
        status: 'PASS',
        phase_5_executed: true,
        errors: [],
        warnings: [],
        edit_scope: [],
        regression_detected: false,
      };

      const result = await gateEnforcer.checkPhase5Testing(qaReport);

      expect(result.passed).toBe(true);
    });
  });

  describe('GATE 4: Fix Attempts History', () => {
    it('should return empty string when no attempts', async () => {
      // Create test session via sessionManager
      const { sessionManager } = await import('../../src/orchestrator/session-manager.js');
      const session = await sessionManager.createSession();

      const formatted = await gateEnforcer.injectFixAttempts(session.id);

      expect(formatted).toBe('');
    });
  });

  describe('GATE 5: MCP Call Verification', () => {
    it('should pass for non-builder agents', async () => {
      const result = await gateEnforcer.verifyMCPCalls(mockSession, 'researcher');

      expect(result.passed).toBe(true);
      expect(result.gate).toBe('GATE_5');
    });

    it('should block Builder without MCP calls', async () => {
      const { sessionManager } = await import('../../src/orchestrator/session-manager.js');
      const session = await sessionManager.createSession();

      const result = await gateEnforcer.verifyMCPCalls(
        { ...mockSession, id: session.id },
        'builder'
      );

      expect(result.passed).toBe(false);
      expect(result.message).toContain('MCP mutation calls');
    });

    it('should block Builder without mutation calls', async () => {
      const { sessionManager } = await import('../../src/orchestrator/session-manager.js');
      const session = await sessionManager.createSession();

      // Add read-only call
      await sessionManager.logMCPCall(session.id, {
        tool: 'mcp__n8n-mcp__n8n_get_workflow',
        type: 'read',
        params: {},
        agentRole: 'builder',
      });

      const result = await gateEnforcer.verifyMCPCalls(
        { ...mockSession, id: session.id },
        'builder'
      );

      expect(result.passed).toBe(false);
      expect(result.message).toContain('mutation call required');
    });

    it('should pass Builder with mutation calls', async () => {
      const { sessionManager } = await import('../../src/orchestrator/session-manager.js');
      const session = await sessionManager.createSession();

      await sessionManager.logMCPCall(session.id, {
        tool: 'mcp__n8n-mcp__n8n_create_workflow',
        type: 'mutation',
        params: {},
        agentRole: 'builder',
      });

      const result = await gateEnforcer.verifyMCPCalls(
        { ...mockSession, id: session.id },
        'builder'
      );

      expect(result.passed).toBe(true);
      expect(result.data).toHaveProperty('mutationCalls', 1);
    });
  });

  describe('GATE 6: Hypothesis Validation', () => {
    it('should block without hypothesis', async () => {
      const findings: ResearchFindings = {
        hypothesis: '',
        hypothesis_validated: false,
        fit_score: 0,
        templates_found: [],
        nodes_found: [],
        existing_workflows: [],
      };

      const result = await gateEnforcer.validateHypothesis(mockSession, findings);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('must provide hypothesis');
    });

    it('should block with unvalidated hypothesis', async () => {
      const findings: ResearchFindings = {
        hypothesis: 'Use Telegram node',
        hypothesis_validated: false,
        fit_score: 0.85,
        templates_found: [],
        nodes_found: [],
        existing_workflows: [],
      };

      const result = await gateEnforcer.validateHypothesis(mockSession, findings);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('must be validated');
      expect(result.data).toHaveProperty('requirement', 'hypothesis_validated: true');
    });

    it('should pass with validated hypothesis', async () => {
      const findings: ResearchFindings = {
        hypothesis: 'Use Telegram node',
        hypothesis_validated: true,
        fit_score: 0.85,
        templates_found: [],
        nodes_found: [],
        existing_workflows: [],
      };

      const result = await gateEnforcer.validateHypothesis(mockSession, findings);

      expect(result.passed).toBe(true);
      expect(result.data).toHaveProperty('validated', true);
    });
  });

  describe('Violation Tracking', () => {
    it('should track violations', async () => {
      mockSession.cycle = 8;
      await gateEnforcer.checkProgressiveEscalation(mockSession, 'builder');

      const violations = gateEnforcer.getViolations();
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].gate).toBe('GATE_1');
    });

    it('should clear violations', () => {
      gateEnforcer.clearViolations();
      const violations = gateEnforcer.getViolations();
      expect(violations).toHaveLength(0);
    });
  });
});
