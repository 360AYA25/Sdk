/**
 * ClaudeN8N SDK v2 - Entry Point
 * Simplified with official SDK approach
 *
 * Usage:
 *   npm run analyze <workflowId> [projectPath]
 *   npm run fix <sessionId> <workflowId>
 */

import 'dotenv/config';
import { analyzeWorkflow } from './analyze-flow.js';
import { runSequentialFix } from './fix-flow.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'analyze': {
      const workflowId = args[1];
      const projectPath = args[2];

      if (!workflowId) {
        console.log('ClaudeN8N SDK v2.0');
        console.log('');
        console.log('Usage:');
        console.log('  npm run analyze <workflowId> [projectPath]');
        console.log('  npm run fix <sessionId> <workflowId>');
        console.log('');
        console.log('Examples:');
        console.log('  npm run analyze sw3Qs3Fe3JahEbbW');
        console.log('  npm run analyze sw3Qs3Fe3JahEbbW /path/to/project');
        console.log('  npm run fix session_abc123 sw3Qs3Fe3JahEbbW');
        process.exit(1);
      }

      const result = await analyzeWorkflow(workflowId, projectPath);

      if (result.success) {
        console.log('\nOK Analysis complete');
        console.log(`Session: ${result.sessionId}`);
        console.log(`TODO: ${result.todoPath ?? 'none'}`);
        console.log('\nTo apply fixes:');
        console.log(`npm run fix ${result.sessionId} ${workflowId}`);
      } else {
        console.error('\nFAIL Analysis failed:', result.error);
        process.exit(1);
      }
      break;
    }

    case 'fix': {
      const sessionId = args[1];
      const workflowId = args[2];

      if (!sessionId || !workflowId) {
        console.error('Usage: npm run fix <sessionId> <workflowId>');
        process.exit(1);
      }

      const result = await runSequentialFix(sessionId, workflowId);

      console.log('\n' + '='.repeat(60));
      console.log('FIX COMPLETE');
      console.log(`Completed: ${result.tasksCompleted}`);
      console.log(`Failed: ${result.tasksFailed}`);

      if (!result.success) {
        process.exit(1);
      }
      break;
    }

    default:
      console.log('ClaudeN8N SDK v2.0');
      console.log('');
      console.log('Commands:');
      console.log('  npm run analyze <workflowId> [projectPath]  - Analyze workflow');
      console.log('  npm run fix <sessionId> <workflowId>        - Apply fixes');
      console.log('');
      console.log('Environment Variables:');
      console.log('  N8N_API_URL         - n8n API URL');
      console.log('  N8N_API_KEY         - n8n API key');
      console.log('  ANTHROPIC_API_KEY   - Anthropic API key (optional)');
      console.log('  SUPABASE_ENABLED    - Enable Supabase MCP (true/false)');
      console.log('  EXTERNAL_TEST_ENABLED - Enable external testing (true/false)');
  }
}

// Export new modules
export { analyzeWorkflow, type AnalyzeResult } from './analyze-flow.js';
export { runSequentialFix, type FixResult, type TaskFixResult } from './fix-flow.js';
export { buildOptions, agents, hooks, getMcpServers, resetState } from './sdk-config.js';
export * from './lib/todo.js';
export * from './lib/snapshot.js';
export * from './lib/external-test.js';
export * from './lib/node-isolation.js';

// Run if executed directly
main().catch(console.error);
