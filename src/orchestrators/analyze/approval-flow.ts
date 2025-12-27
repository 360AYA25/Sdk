/**
 * Approval Flow
 *
 * Handles user interaction after analysis is complete.
 * Options:
 * - [A] Apply fixes automatically (uses Builder + QA agents)
 * - [M] Manual mode (show instructions)
 * - [S] Save report and exit
 * - [Q] Quit without saving
 */

import * as readline from 'readline';
import type {
  AnalysisReport,
  Recommendation,
  SessionContext,
} from '../../types.js';
import { builderAgent } from '../../agents/builder.js';
import { qaAgent } from '../../agents/qa.js';

export type UserChoice = 'auto-fix' | 'manual' | 'save' | 'quit';

export interface FixResult {
  recommendationId: string;
  applied: boolean;
  validated: boolean;
  error?: string;
}

export class ApprovalFlow {
  private reportPath: string;
  private rl: readline.Interface;

  constructor(reportPath: string) {
    this.reportPath = reportPath;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Prompt user for choice after analysis
   */
  async promptUser(report: AnalysisReport): Promise<UserChoice> {
    console.log('\n' + '═'.repeat(60));
    console.log('ANALYSIS COMPLETE');
    console.log('═'.repeat(60));

    const criticalCount = report.summary.criticalIssues;
    const otherCount = report.summary.totalIssues - criticalCount;

    console.log(`\nFound: ${criticalCount} critical, ${otherCount} other issues`);
    console.log(`Overall health: ${this.getHealthEmoji(report.summary.overallHealth)} ${report.summary.overallHealth}`);
    console.log(`Report: ${this.reportPath}`);
    console.log('');

    const p0p1Count = report.recommendations.filter(
      r => r.priority === 'P0' || r.priority === 'P1'
    ).length;

    console.log('What would you like to do?');
    console.log('');
    console.log(`[A] Apply fixes automatically (${p0p1Count} priority fixes - Builder agent)`);
    console.log('[M] Review and apply manually (show detailed instructions)');
    console.log('[S] Save report and exit');
    console.log('[Q] Quit without saving');
    console.log('');

    const choice = await this.readUserInput('Choice [A/M/S/Q]: ');
    return this.parseChoice(choice);
  }

  /**
   * Parse user choice
   */
  private parseChoice(input: string): UserChoice {
    const normalized = input.trim().toUpperCase();

    switch (normalized) {
      case 'A':
        return 'auto-fix';
      case 'M':
        return 'manual';
      case 'S':
        return 'save';
      case 'Q':
        return 'quit';
      default:
        console.log('Invalid choice, defaulting to Save');
        return 'save';
    }
  }

  /**
   * Run auto-fix mode with Builder + QA agents
   */
  async runAutoFix(
    report: AnalysisReport,
    workflowId: string,
    session: SessionContext
  ): Promise<FixResult[]> {
    // Filter P0 and P1 recommendations
    const priorityFixes = report.recommendations.filter(
      r => r.priority === 'P0' || r.priority === 'P1'
    );

    if (priorityFixes.length === 0) {
      console.log('\nNo priority fixes to apply.');
      return [];
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log('AUTO-FIX MODE');
    console.log(`${'─'.repeat(60)}`);
    console.log(`\nApplying ${priorityFixes.length} priority fixes...\n`);

    const results: FixResult[] = [];

    // Note: Agents are already in CREATE mode (reset by analyzer)

    for (let i = 0; i < priorityFixes.length; i++) {
      const rec = priorityFixes[i];

      console.log(`\n[${i + 1}/${priorityFixes.length}] ${rec.priority}: ${rec.title}`);
      console.log(`Description: ${rec.description}`);

      // Find related findings for context
      const relatedFindings = report.findings.filter(f =>
        rec.relatedFindings.includes(f.id)
      );

      if (relatedFindings.length > 0) {
        console.log('Affected nodes:',
          [...new Set(relatedFindings.flatMap(f => f.affectedNodes || []))].join(', ')
        );
      }

      // Ask for confirmation
      const confirm = await this.readUserInput('Apply this fix? [Y/n]: ');

      if (confirm.toLowerCase() === 'n') {
        console.log('  Skipped');
        results.push({
          recommendationId: rec.id,
          applied: false,
          validated: false,
        });
        continue;
      }

      try {
        // Build edit scope from related findings
        const editScope = relatedFindings.flatMap(f => f.affectedNodes || []);

        // Apply fix using Builder
        console.log('  Applying fix...');
        const buildResult = await builderAgent.fix(
          session,
          workflowId,
          editScope,
          rec.description
        );

        if (!buildResult.verification.expected_changes_applied) {
          throw new Error('Builder failed to apply fix');
        }

        // Validate with QA
        console.log('  Validating...');
        const qaReport = await qaAgent.validate(session, workflowId);

        if (qaReport.status === 'PASS') {
          console.log('  \u2705 Fix applied and validated');
          results.push({
            recommendationId: rec.id,
            applied: true,
            validated: true,
          });
        } else {
          console.log('  \u26a0\ufe0f Fix applied but validation has warnings');
          results.push({
            recommendationId: rec.id,
            applied: true,
            validated: false,
          });
        }
      } catch (error) {
        console.log(`  \u274c Fix failed: ${(error as Error).message}`);
        results.push({
          recommendationId: rec.id,
          applied: false,
          validated: false,
          error: (error as Error).message,
        });
      }
    }

    // Summary
    console.log(`\n${'─'.repeat(60)}`);
    console.log('FIX SUMMARY');
    console.log(`${'─'.repeat(60)}`);

    const applied = results.filter(r => r.applied).length;
    const validated = results.filter(r => r.validated).length;
    const failed = results.filter(r => !r.applied).length;

    console.log(`Applied: ${applied}/${priorityFixes.length}`);
    console.log(`Validated: ${validated}/${priorityFixes.length}`);
    console.log(`Failed: ${failed}/${priorityFixes.length}`);

    return results;
  }

  /**
   * Show manual fix instructions
   */
  async showManualInstructions(report: AnalysisReport): Promise<void> {
    console.log('\n' + '═'.repeat(60));
    console.log('MANUAL FIX INSTRUCTIONS');
    console.log('═'.repeat(60));

    // Group by priority
    const byPriority: Record<string, Recommendation[]> = {
      P0: [],
      P1: [],
      P2: [],
      P3: [],
    };

    for (const rec of report.recommendations) {
      byPriority[rec.priority]?.push(rec);
    }

    // Show P0 first, then P1, etc.
    for (const priority of ['P0', 'P1', 'P2', 'P3']) {
      const recs = byPriority[priority];

      if (recs.length === 0) continue;

      console.log(`\n## ${priority} Fixes (${this.getPriorityLabel(priority)})`);
      console.log('─'.repeat(40));

      for (const rec of recs) {
        console.log(`\n### ${rec.id}: ${rec.title}`);
        console.log(`\nDescription: ${rec.description}`);
        console.log(`Effort: ${rec.effort} | Impact: ${rec.impact}`);

        // Find related findings for details
        const findings = report.findings.filter(f =>
          rec.relatedFindings.includes(f.id)
        );

        if (findings.length > 0) {
          for (const finding of findings) {
            console.log(`\nAffected nodes: ${finding.affectedNodes?.join(', ') || 'N/A'}`);
            console.log('Evidence:');
            for (const e of finding.evidence) {
              console.log(`  - ${e}`);
            }
          }
        }

        console.log('\n' + '-'.repeat(40));
      }
    }

    console.log('\n\nTo apply fixes:');
    console.log('1. Open your n8n instance');
    console.log(`2. Navigate to workflow: ${report.summary.workflowName}`);
    console.log('3. Follow the instructions above for each node');
    console.log('4. Test after each major change');
    console.log('\nReport saved to:', this.reportPath);
  }

  /**
   * Read user input
   */
  private readUserInput(prompt: string): Promise<string> {
    return new Promise(resolve => {
      this.rl.question(prompt, answer => {
        resolve(answer);
      });
    });
  }

  /**
   * Close readline interface
   */
  close(): void {
    this.rl.close();
  }

  /**
   * Get priority label
   */
  private getPriorityLabel(priority: string): string {
    switch (priority) {
      case 'P0':
        return 'Critical - Fix Immediately';
      case 'P1':
        return 'High - Fix Soon';
      case 'P2':
        return 'Medium - Plan to Fix';
      case 'P3':
        return 'Low - Nice to Have';
      default:
        return priority;
    }
  }

  /**
   * Get health emoji
   */
  private getHealthEmoji(health: string): string {
    switch (health) {
      case 'healthy':
        return '\u2705';
      case 'needs_attention':
        return '\u26a0\ufe0f';
      case 'critical':
        return '\ud83d\udd34';
      default:
        return '\u2753';
    }
  }
}
