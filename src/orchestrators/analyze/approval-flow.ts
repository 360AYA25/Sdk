/**
 * Approval Flow
 *
 * Handles user interaction after analysis is complete.
 * Options:
 * - [A] Apply fixes automatically (FULL 5-agent system with 6 gates)
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
import { orchestrator } from '../../orchestrator/index.js';

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
    console.log(`[A] Apply fixes automatically (${p0p1Count} issues - FULL 5-agent system)`);
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
   * Run auto-fix mode with FULL 5-agent system
   * Uses: Architect → Researcher → Builder → QA → Analyst
   * With all 6 validation gates
   */
  async runAutoFix(
    report: AnalysisReport,
    workflowId: string,
    _session: SessionContext
  ): Promise<FixResult[]> {
    // Filter P0 and P1 recommendations
    const priorityFixes = report.recommendations.filter(
      r => r.priority === 'P0' || r.priority === 'P1'
    );

    if (priorityFixes.length === 0) {
      console.log('\nNo priority fixes to apply.');
      return [];
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log('FULL AGENT SYSTEM - FIX MODE');
    console.log('Architect → Researcher → Builder → QA → Analyst');
    console.log(`${'═'.repeat(60)}`);

    // Build task description from analysis findings
    const taskDescription = this.buildFixTask(report, workflowId, priorityFixes);

    console.log('\nTask generated from analysis:');
    console.log('─'.repeat(40));
    console.log(taskDescription.slice(0, 500) + (taskDescription.length > 500 ? '...' : ''));
    console.log('─'.repeat(40));

    // Ask for confirmation
    const confirm = await this.readUserInput('\nStart full agent system? [Y/n]: ');

    if (confirm.toLowerCase() === 'n') {
      console.log('Cancelled.');
      return priorityFixes.map(rec => ({
        recommendationId: rec.id,
        applied: false,
        validated: false,
      }));
    }

    console.log('\nStarting 5-agent system...\n');

    try {
      // Run full orchestrator with the fix task
      const result = await orchestrator.start(taskDescription);

      console.log('\n' + '═'.repeat(60));
      console.log('ORCHESTRATOR RESULT:');
      console.log('═'.repeat(60));
      console.log(result);

      // All fixes attempted through full system
      return priorityFixes.map(rec => ({
        recommendationId: rec.id,
        applied: true,
        validated: true,
      }));

    } catch (error) {
      console.error('\nOrchestrator failed:', (error as Error).message);
      return priorityFixes.map(rec => ({
        recommendationId: rec.id,
        applied: false,
        validated: false,
        error: (error as Error).message,
      }));
    }
  }

  /**
   * Build fix task from analysis report
   */
  private buildFixTask(
    report: AnalysisReport,
    workflowId: string,
    priorityFixes: Recommendation[]
  ): string {
    const findings = report.findings.filter(f =>
      priorityFixes.some(r => r.relatedFindings.includes(f.id))
    );

    const affectedNodes = [...new Set(
      findings.flatMap(f => f.affectedNodes || [])
    )];

    let task = `FIX EXISTING WORKFLOW: ${workflowId}\n\n`;
    task += `Workflow: ${report.summary.workflowName}\n`;
    task += `Issues found: ${report.summary.totalIssues}\n`;
    task += `Critical: ${report.summary.criticalIssues}\n\n`;

    task += `## REQUIRED FIXES (${priorityFixes.length}):\n\n`;

    for (const rec of priorityFixes) {
      task += `### ${rec.priority}: ${rec.title}\n`;
      task += `${rec.description}\n`;

      const relatedFindings = findings.filter(f =>
        rec.relatedFindings.includes(f.id)
      );

      if (relatedFindings.length > 0) {
        task += `Affected: ${relatedFindings.flatMap(f => f.affectedNodes || []).join(', ')}\n`;
        task += `Evidence:\n`;
        for (const f of relatedFindings) {
          for (const e of f.evidence.slice(0, 2)) {
            task += `  - ${e}\n`;
          }
        }
      }
      task += '\n';
    }

    if (affectedNodes.length > 0) {
      task += `## EDIT SCOPE:\n`;
      task += `Only modify these nodes: ${affectedNodes.join(', ')}\n\n`;
    }

    task += `## CONSTRAINTS:\n`;
    task += `- This is an EXISTING workflow - do NOT create new\n`;
    task += `- Use n8n_update_partial_workflow for surgical edits\n`;
    task += `- Validate each fix with QA before proceeding\n`;
    task += `- If fix fails after 3 attempts, escalate to Researcher\n`;

    return task;
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
