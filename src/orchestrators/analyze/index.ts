/**
 * Analyzer Orchestrator
 *
 * Implements Context-First analysis flow with inter-agent communication.
 *
 * Flow:
 * 1. Load all context (parallel)
 * 2. Architect understands intent
 * 3. Researcher investigates (can ask Architect)
 * 4. Analyst synthesizes (can ask both)
 * 5. Generate report
 */

import { promises as fs } from 'fs';
import path from 'path';
import { SharedContextStore } from '../../shared/context-store.js';
import { MessageCoordinator } from '../../shared/message-protocol.js';
import { ApprovalFlow } from './approval-flow.js';
import { architectAgent } from '../../agents/architect.js';
import { researcherAgent } from '../../agents/researcher.js';
import { analystAgent } from '../../agents/analyst.js';
import type {
  AnalysisResult,
  AnalysisReport,
  SessionContext,
} from '../../types.js';

// Project paths
const PROJECT_ROOT = process.cwd();
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

export class AnalyzerOrchestrator {
  private store!: SharedContextStore;
  private coordinator!: MessageCoordinator;

  /**
   * Main entry point for analysis
   */
  async analyze(
    workflowId: string,
    projectPath?: string
  ): Promise<AnalysisResult> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       Context-First Workflow Analyzer                      ║');
    console.log('║  Architect → Researcher → Analyst (with Q&A)               ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Initialize store and coordinator
    this.store = new SharedContextStore(workflowId);
    this.coordinator = new MessageCoordinator(this.store);

    // Set agents to ANALYZE mode
    architectAgent.setMode('analyze');
    researcherAgent.setMode('analyze');
    analystAgent.setMode('analyze');

    // Register message handlers for Q&A
    this.coordinator.registerHandler('architect', {
      handleMessage: (msg) => architectAgent.handleQuestion(msg, this.store),
    });
    this.coordinator.registerHandler('researcher', {
      handleMessage: (msg) => researcherAgent.handleQuestion(msg, this.store),
    });

    try {
      // === PHASE 0: Load Context (Parallel) ===
      console.log('\n[Phase 0] Loading context...');
      this.store.updateStatus('loading');
      await this.loadAllContext(workflowId, projectPath);

      // === PHASE 1: Architect Understanding ===
      console.log('\n[Phase 1] Architect analyzing project context...');
      this.store.updateStatus('understanding');
      await architectAgent.initialize();
      const architectAnalysis = await architectAgent.analyzeProjectContext(this.store);
      console.log(`  ✓ Business context: ${architectAnalysis.businessContext.purpose}`);
      console.log(`  ✓ Services identified: ${architectAnalysis.serviceArchitecture.services.length}`);
      console.log(`  ✓ Gaps found: ${architectAnalysis.gapAnalysis.gaps.length}`);

      // === PHASE 2: Researcher Investigation ===
      console.log('\n[Phase 2] Researcher investigating workflow...');
      this.store.updateStatus('investigating');
      await researcherAgent.initialize();
      const researcherFindings = await researcherAgent.auditWorkflow(
        this.store,
        this.coordinator
      );
      console.log(`  ✓ Nodes audited: ${researcherFindings.nodeAudits.length}`);
      console.log(`  ✓ Issues found: ${researcherFindings.totalIssues}`);
      console.log(`  ✓ Questions asked: ${researcherFindings.questionsAsked}`);

      // Process any pending Q&A
      await this.runQALoop();

      // === PHASE 3: Analyst Synthesis ===
      console.log('\n[Phase 3] Analyst synthesizing report...');
      this.store.updateStatus('synthesizing');
      await analystAgent.initialize();
      const report = await analystAgent.generateAnalysisReport(
        this.store,
        this.coordinator
      );

      // Process final Q&A if needed
      await this.runQALoop();

      // === PHASE 4: Generate Output ===
      console.log('\n[Phase 4] Generating report...');
      this.store.updateStatus('complete');

      const outputPath = await this.writeReport(report, workflowId);

      console.log('\n' + '═'.repeat(60));
      console.log('Analysis complete!');
      console.log(`Report: ${outputPath}`);
      console.log('Summary:');
      console.log(`  • Overall health: ${report.summary.overallHealth}`);
      console.log(`  • Critical issues: ${report.summary.criticalIssues}`);
      console.log(`  • Total issues: ${report.summary.totalIssues}`);
      console.log(`  • Recommendations: ${report.recommendations.length}`);
      console.log(`  • Q&A exchanges: ${this.store.get('resolvedMessages').length}`);

      return {
        success: true,
        report,
        outputPath,
        analysisId: this.store.get('analysisId'),
      };

    } catch (error) {
      console.error('\n[Analyzer] Failed:', error);
      return {
        success: false,
        error: (error as Error).message,
        analysisId: this.store.get('analysisId'),
      };
    } finally {
      // Reset agents to CREATE mode
      architectAgent.setMode('create');
      researcherAgent.setMode('create');
      analystAgent.setMode('create');

      // Clear coordinator handlers
      this.coordinator.clearHandlers();
    }
  }

  /**
   * Load all context in parallel
   */
  private async loadAllContext(
    workflowId: string,
    projectPath?: string
  ): Promise<void> {
    const tasks: Promise<void>[] = [
      this.loadWorkflowData(workflowId),
      this.loadExecutionHistory(workflowId),
    ];

    if (projectPath) {
      tasks.push(this.loadProjectDocs(projectPath));
    }

    await Promise.all(tasks);

    console.log('  ✓ Workflow data loaded');
    console.log(`  ✓ ${this.store.get('workflowData').nodes.length} nodes found`);
    console.log('  ✓ Execution history loaded');
    if (projectPath) {
      console.log('  ✓ Project docs loaded');
    }
  }

  /**
   * Load project documentation
   */
  private async loadProjectDocs(projectPath: string): Promise<void> {
    const docs = {
      readme: await this.readFileIfExists(`${projectPath}/README.md`),
      todo: await this.readFileIfExists(`${projectPath}/TODO.md`),
      plan: await this.readFileIfExists(`${projectPath}/PLAN.md`),
      architecture: await this.readFileIfExists(`${projectPath}/ARCHITECTURE.md`),
      contextFiles: {} as Record<string, string>,
    };

    // Load .context/ folder if exists
    const contextDir = `${projectPath}/.context`;
    if (await this.directoryExists(contextDir)) {
      try {
        const files = await fs.readdir(contextDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const content = await fs.readFile(
              path.join(contextDir, file),
              'utf-8'
            );
            docs.contextFiles[file] = content;
          }
        }
      } catch {
        // Ignore errors reading context dir
      }
    }

    this.store.set('projectDocs', docs, 'orchestrator');
  }

  /**
   * Load workflow data via MCP (simulated - will use real MCP in production)
   */
  private async loadWorkflowData(workflowId: string): Promise<void> {
    // In production, this would call MCP tools
    // For now, we'll structure the data as expected
    console.log(`  Loading workflow ${workflowId} via MCP...`);

    // Note: This is a placeholder. In real implementation,
    // the MCP calls would be made by the agents or orchestrator
    // using the actual MCP server connection

    // For testing, we'll create minimal workflow data structure
    // The actual data will be populated when agents make MCP calls
    this.store.set('workflowData', {
      id: workflowId,
      name: 'Loading...',
      active: false,
      nodes: [],
      connections: {},
      settings: {},
    }, 'orchestrator');

    // Initialize empty node schemas
    this.store.set('nodeSchemas', {}, 'orchestrator');
  }

  /**
   * Load execution history
   */
  private async loadExecutionHistory(workflowId: string): Promise<void> {
    // In production, this would call MCP tools
    // For now, initialize empty history
    this.store.set('executionHistory', {
      total: 0,
      successRate: 0,
      recentExecutions: [],
      errorPatterns: [],
    }, 'orchestrator');
  }

  /**
   * Run Q&A loop until no pending messages
   */
  private async runQALoop(): Promise<void> {
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops

    while (iterations < maxIterations) {
      const pendingCount = this.coordinator.getPendingCount();

      if (pendingCount === 0) break;

      console.log(`  [Q&A] Processing ${pendingCount} pending messages...`);
      const processed = await this.coordinator.processPendingMessages();
      console.log(`  [Q&A] Processed ${processed} messages`);
      iterations++;
    }

    if (iterations >= maxIterations) {
      console.warn('  [Q&A] Max iterations reached, some messages may be unresolved');
    }
  }

  /**
   * Write final report
   */
  private async writeReport(
    report: AnalysisReport,
    workflowId: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ANALYSIS-${workflowId}-${timestamp}.md`;
    const outputPath = path.join(REPORTS_DIR, filename);

    // Generate markdown report
    const markdown = analystAgent.generateMarkdownReport(report);

    // Ensure reports directory exists
    await fs.mkdir(REPORTS_DIR, { recursive: true });
    await fs.writeFile(outputPath, markdown);

    // Also save JSON for programmatic access
    const jsonPath = path.join(REPORTS_DIR, `ANALYSIS-${workflowId}-${timestamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

    return outputPath;
  }

  /**
   * Helper: Read file if exists
   */
  private async readFileIfExists(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Helper: Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Analyze with interactive approval flow
   * Call this for CLI use - prompts user after analysis
   */
  async analyzeWithApproval(
    workflowId: string,
    projectPath?: string
  ): Promise<AnalysisResult> {
    // Run standard analysis first
    const result = await this.analyze(workflowId, projectPath);

    if (!result.success || !result.report || !result.outputPath) {
      return result;
    }

    // Create approval flow
    const approvalFlow = new ApprovalFlow(result.outputPath);

    try {
      const choice = await approvalFlow.promptUser(result.report);

      switch (choice) {
        case 'auto-fix': {
          // Create session for fixing
          const session: SessionContext = {
            id: result.analysisId,
            workflowId,
            stage: 'build',
            cycle: 0,
            startedAt: new Date(),
            lastUpdatedAt: new Date(),
            history: [],
            fixAttempts: [],
            mcpCalls: [],
            agentResults: new Map(),
          };

          const fixResults = await approvalFlow.runAutoFix(
            result.report,
            workflowId,
            session
          );

          console.log(`\n${fixResults.filter(r => r.applied).length} fixes applied`);
          break;
        }

        case 'manual':
          await approvalFlow.showManualInstructions(result.report);
          break;

        case 'save':
          console.log(`\nReport saved: ${result.outputPath}`);
          break;

        case 'quit':
          console.log('\nExiting without saving.');
          // Delete report files
          try {
            const timestamp = new Date().toISOString().split('T')[0];
            await fs.unlink(result.outputPath);
            await fs.unlink(
              path.join(REPORTS_DIR, `ANALYSIS-${workflowId}-${timestamp}.json`)
            );
          } catch {
            // Ignore delete errors
          }
          break;
      }
    } finally {
      approvalFlow.close();
    }

    return result;
  }
}

// Export singleton instance
export const analyzerOrchestrator = new AnalyzerOrchestrator();
