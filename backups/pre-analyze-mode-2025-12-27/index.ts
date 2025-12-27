/**
 * ClaudeN8N SDK - Main Entry Point
 *
 * 5-Agent n8n Workflow Automation System
 * Migrated to Claude Agent SDK
 *
 * Usage:
 *   npm start                           # Interactive mode
 *   npm start -- "Create Telegram bot"  # Direct task
 */

import 'dotenv/config';
import { orchestrator } from './orchestrator/index.js';

// Validate environment
function validateEnv(): void {
  // ANTHROPIC_API_KEY is optional - Agent SDK uses Claude Code subscription if not provided
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[SDK] Using Claude Code built-in authentication');
  } else {
    console.log('[SDK] Using ANTHROPIC_API_KEY from .env');
  }
}

// Main entry point
async function main(): Promise<void> {
  validateEnv();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           ClaudeN8N SDK - 5-Agent System                   ║');
  console.log('║  Architect → Researcher → Builder → QA → Analyst          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Get task from command line or use interactive mode
  const args = process.argv.slice(2);
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

// Export for programmatic use
export { orchestrator } from './orchestrator/index.js';
export { sessionManager } from './orchestrator/session-manager.js';
export { gateEnforcer } from './orchestrator/gate-enforcer.js';
export { architectAgent } from './agents/architect.js';
export { researcherAgent } from './agents/researcher.js';
export { builderAgent } from './agents/builder.js';
export { qaAgent } from './agents/qa.js';
export { analystAgent } from './agents/analyst.js';
export * from './types.js';

// Run if executed directly
main().catch(console.error);
