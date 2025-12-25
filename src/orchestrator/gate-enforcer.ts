/**
 * Gate Enforcer
 * Implements all 6 validation gates from validation-gates.md
 *
 * Gates:
 * - GATE 1: Progressive Escalation (cycle-based)
 * - GATE 2: Execution Analysis Requirement
 * - GATE 3: Phase 5 Real Testing
 * - GATE 4: Fix Attempts History (automatic injection)
 * - GATE 5: MCP Call Verification
 * - GATE 6: Hypothesis Validation
 */

import type {
  SessionContext,
  GateResult,
  GateViolation,
  AgentRole,
  QAReport,
  ResearchFindings,
  MCPCall,
} from '../types.js';
import { sessionManager } from './session-manager.js';

export class GateEnforcer {
  private violations: GateViolation[] = [];

  /**
   * GATE 1: Progressive Escalation
   * Blocks Builder if cycle >= 4 without Researcher
   * Blocks all agents if cycle >= 8
   */
  async checkProgressiveEscalation(
    session: SessionContext,
    targetAgent: AgentRole
  ): Promise<GateResult> {
    const { cycle } = session;

    // Cycle 8+: Block all, trigger L4
    if (cycle >= 8) {
      this.logViolation('GATE_1', 'Maximum cycles exceeded', { cycle });
      return {
        gate: 'GATE_1',
        passed: false,
        message: `BLOCKED: Maximum 7 cycles exceeded (current: ${cycle}). Triggering L4 escalation.`,
        data: { escalation: 'L4', triggerAnalyst: true },
      };
    }

    // Cycle 4-7: Require Researcher before Builder
    if (cycle >= 4 && targetAgent === 'builder') {
      const researcherResult = session.agentResults.get('researcher');
      const hasRecentResearch = researcherResult &&
        new Date(researcherResult.timestamp).getTime() > Date.now() - 300000; // 5 min

      if (!hasRecentResearch) {
        return {
          gate: 'GATE_1',
          passed: false,
          message: `BLOCKED: Cycle ${cycle} requires Researcher analysis before Builder.`,
          data: { requireAgent: 'researcher', escalation: cycle >= 6 ? 'L3' : 'L2' },
        };
      }
    }

    return { gate: 'GATE_1', passed: true };
  }

  /**
   * GATE 2: Execution Analysis Requirement
   * Blocks Builder without execution_analysis.completed
   * Requires L-067 two-step analysis
   */
  async checkExecutionAnalysis(
    session: SessionContext,
    hasFailedExecution: boolean
  ): Promise<GateResult> {
    if (!hasFailedExecution) {
      return { gate: 'GATE_2', passed: true };
    }

    const researcherResult = session.agentResults.get('researcher');
    const findings = researcherResult?.data as ResearchFindings | undefined;

    // Check for L-067 compliance (two-step analysis)
    const hasTwoStepAnalysis = this.checkL067Compliance(session);

    if (!hasTwoStepAnalysis) {
      this.logViolation('GATE_2', 'Missing execution analysis', {
        cycle: session.cycle,
        hasFailedExecution,
      });

      return {
        gate: 'GATE_2',
        passed: false,
        message: 'BLOCKED: L-067 two-step execution analysis required before fix.',
        data: {
          requireAgent: 'researcher',
          protocol: 'L-067',
          steps: ['mode=summary to find WHERE', 'mode=filtered to find WHY'],
        },
      };
    }

    if (!findings?.hypothesis_validated) {
      return {
        gate: 'GATE_2',
        passed: false,
        message: 'BLOCKED: Execution analysis incomplete. Hypothesis not validated.',
        data: { requireValidation: true },
      };
    }

    return { gate: 'GATE_2', passed: true };
  }

  /**
   * GATE 3: Phase 5 Real Testing
   * Blocks QA PASS without phase_5_executed: true
   */
  async checkPhase5Testing(qaReport: QAReport): Promise<GateResult> {
    if (qaReport.status !== 'PASS') {
      return { gate: 'GATE_3', passed: true }; // Only applies to PASS
    }

    if (!qaReport.phase_5_executed) {
      this.logViolation('GATE_3', 'QA PASS without Phase 5 testing', {
        status: qaReport.status,
        phase_5_executed: false,
      });

      return {
        gate: 'GATE_3',
        passed: false,
        message: 'REJECTED: QA PASS requires Phase 5 real workflow testing.',
        data: {
          requirement: 'phase_5_executed: true',
          action: 'Execute workflow via n8n_test_workflow',
        },
      };
    }

    return { gate: 'GATE_3', passed: true };
  }

  /**
   * GATE 4: Fix Attempts History
   * Automatically injects ALREADY_TRIED into Builder prompt
   */
  async injectFixAttempts(sessionId: string): Promise<string> {
    return sessionManager.formatAlreadyTried(sessionId);
  }

  /**
   * GATE 5: MCP Call Verification
   * Blocks Builder success without mcp_calls array
   */
  async verifyMCPCalls(
    session: SessionContext,
    agentRole: AgentRole
  ): Promise<GateResult> {
    if (agentRole !== 'builder') {
      return { gate: 'GATE_5', passed: true };
    }

    const mcpCalls = await sessionManager.getMCPCalls(session.id, 'builder');

    if (!mcpCalls || mcpCalls.length === 0) {
      this.logViolation('GATE_5', 'No MCP calls logged', {
        agent: 'builder',
        cycle: session.cycle,
      });

      return {
        gate: 'GATE_5',
        passed: false,
        message: 'REJECTED: Builder must log MCP mutation calls (L-071).',
        data: { protocol: 'L-071', requirement: 'mcp_calls array required' },
      };
    }

    const hasMutation = mcpCalls.some(c => c.type === 'mutation');
    if (!hasMutation) {
      return {
        gate: 'GATE_5',
        passed: false,
        message: 'REJECTED: At least one MCP mutation call required.',
        data: { callsLogged: mcpCalls.length, mutationCalls: 0 },
      };
    }

    return {
      gate: 'GATE_5',
      passed: true,
      data: {
        totalCalls: mcpCalls.length,
        mutationCalls: mcpCalls.filter(c => c.type === 'mutation').length,
      },
    };
  }

  /**
   * GATE 6: Hypothesis Validation
   * Blocks Researcher proposal without validation
   */
  async validateHypothesis(
    session: SessionContext,
    findings: ResearchFindings
  ): Promise<GateResult> {
    if (!findings.hypothesis) {
      return {
        gate: 'GATE_6',
        passed: false,
        message: 'BLOCKED: Researcher must provide hypothesis.',
      };
    }

    if (!findings.hypothesis_validated) {
      this.logViolation('GATE_6', 'Unvalidated hypothesis', {
        hypothesis: findings.hypothesis,
        fit_score: findings.fit_score,
      });

      return {
        gate: 'GATE_6',
        passed: false,
        message: 'BLOCKED: Hypothesis must be validated before proposal.',
        data: {
          hypothesis: findings.hypothesis,
          requirement: 'hypothesis_validated: true',
        },
      };
    }

    return {
      gate: 'GATE_6',
      passed: true,
      data: { hypothesis: findings.hypothesis, validated: true },
    };
  }

  /**
   * Check all gates for agent transition
   */
  async checkAllGates(
    session: SessionContext,
    targetAgent: AgentRole,
    context: {
      hasFailedExecution?: boolean;
      qaReport?: QAReport;
      researchFindings?: ResearchFindings;
    }
  ): Promise<{ passed: boolean; violations: GateResult[] }> {
    const results: GateResult[] = [];

    // GATE 1: Progressive Escalation
    const gate1 = await this.checkProgressiveEscalation(session, targetAgent);
    results.push(gate1);

    // GATE 2: Execution Analysis (for Builder)
    if (targetAgent === 'builder' && context.hasFailedExecution) {
      const gate2 = await this.checkExecutionAnalysis(session, true);
      results.push(gate2);
    }

    // GATE 3: Phase 5 Testing (for QA result)
    if (context.qaReport) {
      const gate3 = await this.checkPhase5Testing(context.qaReport);
      results.push(gate3);
    }

    // GATE 5: MCP Calls (post-Builder)
    if (targetAgent === 'builder') {
      // Will be checked after Builder returns
    }

    // GATE 6: Hypothesis Validation
    if (context.researchFindings && session.stage === 'decision') {
      const gate6 = await this.validateHypothesis(session, context.researchFindings);
      results.push(gate6);
    }

    const violations = results.filter(r => !r.passed);
    return {
      passed: violations.length === 0,
      violations,
    };
  }

  /**
   * Determine escalation level based on cycle
   */
  getEscalationLevel(cycle: number): {
    level: string;
    action: string;
    agents: AgentRole[];
  } {
    if (cycle <= 3) {
      return {
        level: 'L1',
        action: 'Builder direct fix',
        agents: ['builder'],
      };
    } else if (cycle <= 5) {
      return {
        level: 'L2',
        action: 'Researcher alternative approach → Builder',
        agents: ['researcher', 'builder'],
      };
    } else if (cycle <= 7) {
      return {
        level: 'L3',
        action: 'Researcher deep dive → Builder',
        agents: ['researcher', 'builder'],
      };
    } else {
      return {
        level: 'L4',
        action: 'Analyst post-mortem → Report to user',
        agents: ['analyst'],
      };
    }
  }

  /**
   * Check L-067 two-step analysis compliance
   */
  private checkL067Compliance(session: SessionContext): boolean {
    const researcherCalls = session.mcpCalls.filter(
      c => c.agentRole === 'researcher' && c.tool === 'mcp__n8n-mcp__n8n_executions'
    );

    // Must have at least 2 calls: summary mode and filtered mode
    const hasSummary = researcherCalls.some(
      c => (c.params as { mode?: string }).mode === 'summary'
    );
    const hasFiltered = researcherCalls.some(
      c => (c.params as { mode?: string }).mode === 'filtered'
    );

    return hasSummary && hasFiltered;
  }

  /**
   * Log gate violation
   */
  private logViolation(
    gate: string,
    reason: string,
    context: Record<string, unknown>
  ): void {
    this.violations.push({
      gate,
      reason,
      context,
      timestamp: new Date(),
    });
  }

  /**
   * Get all violations
   */
  getViolations(): GateViolation[] {
    return this.violations;
  }

  /**
   * Clear violations
   */
  clearViolations(): void {
    this.violations = [];
  }
}

export const gateEnforcer = new GateEnforcer();
