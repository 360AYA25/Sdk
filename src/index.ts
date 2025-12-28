/**
 * ClaudeN8N SDK - Main Entry Point
 *
 * 5-Agent n8n Workflow Automation System
 * Migrated to Claude Agent SDK
 *
 * Usage:
 *   npm start                              # Interactive mode (CREATE)
 *   npm start -- "Create Telegram bot"    # Direct task (CREATE)
 *   npm run analyze -- <workflowId>        # Analyze workflow
 *   npm run analyze -- <workflowId> <projectPath>  # Analyze with docs
 */

import 'dotenv/config';
import { orchestrator } from './orchestrator/index.js';
import { analyzerOrchestrator } from './orchestrators/analyze/index.js';

// Validate environment
function validateEnv(): void {
  // ANTHROPIC_API_KEY is optional - Agent SDK uses Claude Code subscription if not provided
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[SDK] Using Claude Code built-in authentication');
  } else {
    console.log('[SDK] Using ANTHROPIC_API_KEY from .env');
  }
}

// Parse command line arguments
function parseArgs(): { mode: 'create' | 'analyze'; args: string[]; interactive: boolean; autoFix: boolean } {
  const args = process.argv.slice(2);
  let interactive = true;
  let autoFix = false;

  // Check for --no-interactive flag
  const noInteractiveIndex = args.indexOf('--no-interactive');
  if (noInteractiveIndex >= 0) {
    interactive = false;
    args.splice(noInteractiveIndex, 1);
  }

  // Check for --auto-fix flag (runs auto-fix without prompts)
  const autoFixIndex = args.indexOf('--auto-fix');
  if (autoFixIndex >= 0) {
    autoFix = true;
    args.splice(autoFixIndex, 1);
  }

  // Check for --mode flag
  const modeIndex = args.indexOf('--mode');
  if (modeIndex >= 0 && args[modeIndex + 1]) {
    const mode = args[modeIndex + 1] as 'create' | 'analyze';
    const filteredArgs = args.filter((_, i) => i !== modeIndex && i !== modeIndex + 1);
    return { mode, args: filteredArgs, interactive, autoFix };
  }

  // Check for analyze keyword (for npm run analyze)
  if (args[0] === 'analyze') {
    return { mode: 'analyze', args: args.slice(1), interactive, autoFix };
  }

  return { mode: 'create', args, interactive, autoFix };
}

// Main entry point
async function main(): Promise<void> {
  validateEnv();

  const { mode, args, interactive, autoFix } = parseArgs();

  if (mode === 'analyze') {
    // ========== ANALYZE MODE ==========
    const workflowId = args[0];
    const projectPath = args[1];

    if (!workflowId) {
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║       Context-First Workflow Analyzer                      ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('Usage:');
      console.log('  npm run analyze -- <workflowId>');
      console.log('  npm run analyze -- <workflowId> <projectPath>');
      console.log('  npm run analyze -- <workflowId> --no-interactive');
      console.log('  npm run analyze -- <workflowId> --auto-fix');
      console.log('');
      console.log('Options:');
      console.log('  --no-interactive    Skip approval flow, just generate report');
      console.log('  --auto-fix          Run analysis then auto-fix P0/P1 issues (no prompts)');
      console.log('');
      console.log('Examples:');
      console.log('  npm run analyze -- sw3Qs3Fe3JahEbbW');
      console.log('  npm run analyze -- sw3Qs3Fe3JahEbbW /path/to/project');
      console.log('  npm run analyze -- sw3Qs3Fe3JahEbbW --auto-fix');
      process.exit(1);
    }

    console.log(`[ANALYZE] Workflow: ${workflowId}`);
    if (projectPath) {
      console.log(`[ANALYZE] Project: ${projectPath}`);
    }
    console.log(`[ANALYZE] Interactive: ${interactive}`);
    console.log(`[ANALYZE] Auto-fix: ${autoFix}`);
    console.log('');

    // Determine which mode to use
    let result;
    if (autoFix) {
      // Auto-fix mode: analyze then fix without prompts
      result = await analyzerOrchestrator.analyzeAndFix(workflowId, projectPath);
    } else if (interactive) {
      // Interactive mode with approval flow
      result = await analyzerOrchestrator.analyzeWithApproval(workflowId, projectPath);
    } else {
      // Non-interactive: just generate report
      result = await analyzerOrchestrator.analyze(workflowId, projectPath);
    }

    if (result.success) {
      console.log('\nAnalysis completed successfully');
      console.log(`Report: ${result.outputPath}`);
    } else {
      console.error('\nAnalysis failed:', result.error);
      process.exit(1);
    }

  } else {
    // ========== CREATE MODE ==========
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           ClaudeN8N SDK - 5-Agent System                   ║');
    console.log('║  Architect → Researcher → Builder → QA → Analyst          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    const task = args.join(' ');

    if (task) {
      console.log(`Task: ${task}\n`);
      const result = await orchestrator.start(task);
      console.log('\n' + '═'.repeat(60));
      console.log('RESULT:');
      console.log(result);
    } else {
      // Interactive mode
      console.log('Interactive mode - Enter your task:');
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('> ', async (input) => {
        if (input.trim()) {
          const result = await orchestrator.start(input.trim());
          console.log('\n' + '═'.repeat(60));
          console.log('RESULT:');
          console.log(result);
        }
        rl.close();
      });
    }
  }
}

// Export for programmatic use
export { orchestrator } from './orchestrator/index.js';
export { analyzerOrchestrator } from './orchestrators/analyze/index.js';
export { sessionManager } from './orchestrator/session-manager.js';
export { gateEnforcer } from './orchestrator/gate-enforcer.js';
export { architectAgent } from './agents/architect.js';
export { researcherAgent } from './agents/researcher.js';
export { builderAgent } from './agents/builder.js';
export { qaAgent } from './agents/qa.js';
export { analystAgent } from './agents/analyst.js';
export { SharedContextStore } from './shared/context-store.js';
export { MessageCoordinator } from './shared/message-protocol.js';
export { ApprovalFlow } from './orchestrators/analyze/approval-flow.js';
export * from './types.js';

// Run if executed directly
main().catch(console.error);
