/**
 * Fix Orchestrator
 *
 * Dedicated orchestrator for applying fixes to existing workflows.
 * Unlike the main orchestrator (designed for CREATE), this one:
 * - Applies fixes incrementally (one at a time)
 * - Uses n8n_update_partial_workflow for surgical edits
 * - Validates after each fix
 * - Simpler flow: Builder → QA → repeat
 */

import type {
  SessionContext,
  Recommendation,
  ReportFinding,
  AnalysisReport,
} from '../../types.js';
import { builderAgent } from '../../agents/builder.js';
import { qaAgent } from '../../agents/qa.js';
import { sessionManager } from '../../orchestrator/session-manager.js';

export interface FixResult {
  recommendationId: string;
  applied: boolean;
  validated: boolean;
  error?: string;
  attempts: number;
}

export class FixOrchestrator {
  /**
   * Apply fixes incrementally to existing workflow
   */
  async applyFixes(
    workflowId: string,
    report: AnalysisReport,
    priorityFixes: Recommendation[]
  ): Promise<FixResult[]> {
    console.log(`\n${'═'.repeat(60)}`);
    console.log('FIX ORCHESTRATOR - INCREMENTAL MODE');
    console.log(`Workflow: ${workflowId}`);
    console.log(`Fixes: ${priorityFixes.length}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Initialize agents
    await builderAgent.initialize();
    await qaAgent.initialize();

    // Create session for fix tracking
    const session = await sessionManager.createSession(workflowId);
    session.workflowId = workflowId;

    const results: FixResult[] = [];

    // Apply fixes one by one
    for (const fix of priorityFixes) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`${fix.priority}: ${fix.title}`);
      console.log(`${'─'.repeat(60)}`);

      const result = await this.applyFix(session, workflowId, report, fix);
      results.push(result);

      if (result.applied) {
        console.log(`✓ Applied successfully`);
      } else {
        console.warn(`✗ Failed after ${result.attempts} attempts: ${result.error}`);

        // Continue with other fixes even if one fails
        console.log('Continuing with next fix...');
      }
    }

    // Archive session
    await sessionManager.archiveSession(session.id);

    return results;
  }

  /**
   * Apply a single fix with retries
   */
  private async applyFix(
    session: SessionContext,
    workflowId: string,
    report: AnalysisReport,
    fix: Recommendation
  ): Promise<FixResult> {
    const maxAttempts = 3;
    let attempts = 0;

    // Get affected nodes for this fix
    const findings = report.findings.filter(f =>
      fix.relatedFindings.includes(f.id)
    );
    const affectedNodes = [...new Set(
      findings.flatMap(f => f.affectedNodes || [])
    )];

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`\nAttempt ${attempts}/${maxAttempts}`);

      try {
        // Build fix task description
        const fixTask = this.buildSingleFixTask(workflowId, fix, findings, affectedNodes);

        // Call Builder to apply fix
        console.log('Builder: Applying fix...');
        const buildResult = await builderAgent.fix(
          session,
          workflowId,
          affectedNodes,
          fixTask
        );

        // Validate with QA
        console.log('QA: Validating fix...');
        const qaReport = await qaAgent.validate(session, workflowId);

        if (qaReport.status === 'PASS') {
          return {
            recommendationId: fix.id,
            applied: true,
            validated: true,
            attempts,
          };
        }

        // Check if the specific error we were fixing is gone
        const fixedErrors = this.checkFixedErrors(fix, findings, qaReport.errors);
        if (fixedErrors) {
          console.log('Primary error fixed, but new errors introduced');
          // Could continue or retry - for now, continue
          return {
            recommendationId: fix.id,
            applied: true,
            validated: false,
            error: `New errors: ${qaReport.errors.map(e => e.message).join(', ')}`,
            attempts,
          };
        }

        console.warn(`QA validation failed: ${qaReport.errors.length} errors`);

      } catch (error) {
        console.error(`Fix attempt ${attempts} failed:`, (error as Error).message);

        if (attempts === maxAttempts) {
          return {
            recommendationId: fix.id,
            applied: false,
            validated: false,
            error: (error as Error).message,
            attempts,
          };
        }
      }
    }

    return {
      recommendationId: fix.id,
      applied: false,
      validated: false,
      error: `Failed after ${maxAttempts} attempts`,
      attempts,
    };
  }

  /**
   * Build task description for a single fix
   */
  private buildSingleFixTask(
    workflowId: string,
    fix: Recommendation,
    findings: ReportFinding[],
    affectedNodes: string[]
  ): string {
    let task = `APPLY SINGLE FIX TO WORKFLOW ${workflowId}\n\n`;

    task += `## FIX: ${fix.priority} - ${fix.title}\n`;
    task += `${fix.description}\n\n`;

    if (findings.length > 0) {
      task += `## EVIDENCE:\n`;
      for (const finding of findings) {
        task += `\n### ${finding.title}\n`;
        for (const evidence of finding.evidence.slice(0, 3)) {
          task += `- ${evidence}\n`;
        }
      }
      task += '\n';
    }

    if (affectedNodes.length > 0) {
      task += `## AFFECTED NODES:\n`;
      task += affectedNodes.map(n => `- ${n}`).join('\n');
      task += '\n\n';
    }

    task += `## CONSTRAINTS:\n`;
    task += `- Use n8n_update_partial_workflow with updateNode operations\n`;
    task += `- ONLY modify nodes listed in AFFECTED NODES\n`;
    task += `- DO NOT modify any other nodes\n`;
    task += `- Validate syntax before applying\n`;

    return task;
  }

  /**
   * Check if the primary errors for this fix are resolved
   */
  private checkFixedErrors(
    fix: Recommendation,
    findings: ReportFinding[],
    currentErrors: { message: string; node?: string }[]
  ): boolean {
    // Get expected error patterns from findings
    const expectedErrors = findings.flatMap(f => f.affectedNodes || []);

    // Check if any of the current errors match nodes we were supposed to fix
    const stillBroken = currentErrors.some(err =>
      err.node && expectedErrors.includes(err.node)
    );

    return !stillBroken;
  }
}

export const fixOrchestrator = new FixOrchestrator();
