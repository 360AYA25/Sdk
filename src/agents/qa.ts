/**
 * QA Agent
 * Validate + Test, NO fixes
 *
 * Responsibilities:
 * - 5-Phase validation (Structure → Config → Logic → Special → Testing)
 * - GATE 3: Phase 5 Real Testing (MANDATORY!)
 * - L-072: Verify via MCP (not files)
 * - False positive filtering (L-053, L-054)
 * - edit_scope generation
 * - Regression check
 *
 * Key Features:
 * - Read-only (except activation)
 * - Validation-expert skills
 */

import { BaseAgent } from './base-agent.js';
import type {
  SessionContext,
  MCPCall,
  QAReport,
  ValidationError,
  ValidationWarning,
  TestResult,
} from '../types.js';

export class QAAgent extends BaseAgent {
  constructor() {
    super('qa', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      skills: ['n8n-validation-expert', 'n8n-mcp-tools-expert'],
      mcpTools: [
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_list_workflows',
        'mcp__n8n-mcp__n8n_validate_workflow',
        'mcp__n8n-mcp__n8n_test_workflow',
        'mcp__n8n-mcp__n8n_executions',
        'mcp__n8n-mcp__n8n_update_partial_workflow', // Activation only!
        'mcp__n8n-mcp__validate_node',
      ],
      promptFile: 'qa.md',
      indexFile: 'qa_validation.md',
      protocols: ['L-072', 'L-053', 'L-054', 'phase-5-mandatory'],
    });
  }

  /**
   * Process result from Agent SDK
   */
  protected async processResult(
    result: string,
    session: SessionContext,
    mcpCalls: MCPCall[]
  ): Promise<QAReport> {
    return this.parseQAReport(result, mcpCalls);
  }

  /**
   * Parse QA report from response
   */
  private parseQAReport(content: string, mcpCalls: MCPCall[]): QAReport {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const report = JSON.parse(jsonMatch[1]) as QAReport;
        // Validate status is correct type
        if (!['PASS', 'SOFT_PASS', 'FAIL', 'BLOCKED'].includes(report.status)) {
          report.status = 'FAIL';
        }
        return report;
      } catch {
        // Fall through
      }
    }

    // Check if Phase 5 was executed
    const phase5Executed = mcpCalls.some(c =>
      c.tool.includes('test_workflow') || c.tool.includes('executions')
    );

    return {
      status: 'FAIL',
      phase_5_executed: phase5Executed,
      errors: [],
      warnings: [],
      edit_scope: [],
      regression_detected: false,
    };
  }

  /**
   * Full 5-Phase validation
   */
  async validate(
    session: SessionContext,
    workflowId: string
  ): Promise<QAReport> {
    const result = await this.invoke(
      session,
      `Validate workflow ${workflowId}`,
      {
        workflowId,
        instruction: `Execute 5-PHASE VALIDATION:

## Phase 1: Structure Validation
- Check workflow exists (n8n_get_workflow)
- Verify node structure
- Check connections

## Phase 2: Configuration Validation
- Validate each node (validate_node)
- Check required fields
- Verify credentials configured

## Phase 3: Logic Validation
- Check expression syntax
- Verify data flow
- Validate code blocks

## Phase 4: Special Checks
- L-053, L-054 false positive filtering
- Check for known gotchas (builder_gotchas.md)

## Phase 5: REAL TESTING (MANDATORY - GATE 3!)
- Execute workflow (n8n_test_workflow)
- Check execution result
- Verify output data

Return JSON:
{
  "status": "PASS|FAIL|BLOCKED",
  "phase_5_executed": true,  // MUST be true!
  "errors": [{"code": "...", "message": "...", "node": "...", "severity": "error", "autoFixable": false}],
  "warnings": [{"code": "...", "message": "...", "isFalsePositive": false}],
  "edit_scope": ["node1", "node2"],  // Nodes that need fixing
  "regression_detected": false,
  "test_results": [{"testType": "webhook", "success": true, "executionId": "..."}]
}`,
      }
    );

    return result.data as QAReport;
  }

  /**
   * Quick validation (phases 1-4 only)
   */
  async quickValidate(
    session: SessionContext,
    workflowId: string
  ): Promise<Omit<QAReport, 'test_results'>> {
    const result = await this.invoke(
      session,
      `Quick validate workflow ${workflowId}`,
      {
        workflowId,
        instruction: `Quick validation (Phases 1-4 only):
1. Fetch workflow
2. Validate structure
3. Check configurations
4. Filter false positives

Return JSON without test_results.`,
      }
    );

    return result.data as Omit<QAReport, 'test_results'>;
  }

  /**
   * Phase 5 only - Real testing
   */
  async testWorkflow(
    session: SessionContext,
    workflowId: string,
    testData?: Record<string, unknown>
  ): Promise<TestResult[]> {
    const result = await this.invoke(
      session,
      `Test workflow ${workflowId}`,
      {
        workflowId,
        testData,
        instruction: `Execute Phase 5 Real Testing:
1. Determine trigger type (webhook/form/chat)
2. Execute n8n_test_workflow with appropriate data
3. Wait for completion
4. Analyze result

Return JSON array:
[{"testType": "webhook", "success": true, "executionId": "...", "output": {...}}]`,
      }
    );

    return (result.data as { test_results: TestResult[] }).test_results || [];
  }

  /**
   * Check for regressions
   */
  async checkRegression(
    session: SessionContext,
    workflowId: string,
    previousReport: QAReport
  ): Promise<{
    hasRegression: boolean;
    newErrors: ValidationError[];
    fixedErrors: ValidationError[];
  }> {
    const result = await this.invoke(
      session,
      `Check regression for ${workflowId}`,
      {
        workflowId,
        previousReport,
        instruction: `Compare with previous QA report:
1. Get current validation state
2. Compare errors
3. Identify new vs fixed

Return JSON:
{
  "hasRegression": true/false,
  "newErrors": [...],
  "fixedErrors": [...]
}`,
      }
    );

    return result.data as {
      hasRegression: boolean;
      newErrors: ValidationError[];
      fixedErrors: ValidationError[];
    };
  }

  /**
   * Generate edit_scope for Builder
   */
  async generateEditScope(
    session: SessionContext,
    errors: ValidationError[]
  ): Promise<string[]> {
    // Extract unique nodes from errors
    const nodes = new Set<string>();
    for (const error of errors) {
      if (error.node) {
        nodes.add(error.node);
      }
    }

    // Add connected nodes for context
    const result = await this.invoke(
      session,
      'Generate edit scope',
      {
        errorNodes: Array.from(nodes),
        instruction: `Determine minimal edit_scope:
1. Include nodes with errors
2. Add directly connected nodes if needed
3. Keep scope minimal

Return JSON array of node names.`,
      }
    );

    return result.data as string[];
  }

  /**
   * Filter false positives (L-053, L-054)
   */
  filterFalsePositives(warnings: ValidationWarning[]): ValidationWarning[] {
    return warnings.map(warning => {
      // L-053: Expression validation false positives
      if (warning.code === 'expression-validation' &&
          warning.message.includes('cannot validate')) {
        return { ...warning, isFalsePositive: true };
      }

      // L-054: Optional field warnings
      if (warning.code === 'optional-field-missing') {
        return { ...warning, isFalsePositive: true };
      }

      return warning;
    });
  }

  /**
   * Activate workflow (limited mutation permission)
   */
  async activateWorkflow(
    session: SessionContext,
    workflowId: string
  ): Promise<{ activated: boolean }> {
    const result = await this.invoke(
      session,
      `Activate workflow ${workflowId}`,
      {
        workflowId,
        instruction: `Activate workflow:
1. Use n8n_update_partial_workflow with activation operation
2. Verify activation

Return: {"activated": true/false}`,
      }
    );

    return result.data as { activated: boolean };
  }
}

export const qaAgent = new QAAgent();
