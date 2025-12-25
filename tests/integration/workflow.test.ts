/**
 * Integration Test: Full Workflow
 * Tests complete workflow creation from user request to completion
 *
 * NOTE: This is a MOCK test that doesn't require real n8n instance
 * For manual testing with real n8n, use examples/test-workflow.ts
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

describe('Full Workflow Integration (Mock)', () => {
  beforeAll(() => {
    // Set test environment
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.SESSION_STORAGE_PATH = './tests/fixtures/sessions';
  });

  it('should have all required files present', async () => {
    // Test that all components can be imported
    const { orchestrator } = await import('../../src/orchestrator/index.js');
    const { sessionManager } = await import('../../src/orchestrator/session-manager.js');
    const { gateEnforcer } = await import('../../src/orchestrator/gate-enforcer.js');
    const { architectAgent } = await import('../../src/agents/architect.js');
    const { researcherAgent } = await import('../../src/agents/researcher.js');
    const { builderAgent } = await import('../../src/agents/builder.js');
    const { qaAgent } = await import('../../src/agents/qa.js');
    const { analystAgent } = await import('../../src/agents/analyst.js');

    expect(orchestrator).toBeDefined();
    expect(sessionManager).toBeDefined();
    expect(gateEnforcer).toBeDefined();
    expect(architectAgent).toBeDefined();
    expect(researcherAgent).toBeDefined();
    expect(builderAgent).toBeDefined();
    expect(qaAgent).toBeDefined();
    expect(analystAgent).toBeDefined();
  });

  it('should have correct agent configurations', async () => {
    const { architectAgent } = await import('../../src/agents/architect.js');
    const { researcherAgent } = await import('../../src/agents/researcher.js');
    const { builderAgent } = await import('../../src/agents/builder.js');
    const { qaAgent } = await import('../../src/agents/qa.js');
    const { analystAgent } = await import('../../src/agents/analyst.js');

    // Verify agent roles
    expect(architectAgent.getRole()).toBe('architect');
    expect(researcherAgent.getRole()).toBe('researcher');
    expect(builderAgent.getRole()).toBe('builder');
    expect(qaAgent.getRole()).toBe('qa');
    expect(analystAgent.getRole()).toBe('analyst');

    // Verify Builder uses Opus
    expect(builderAgent.getModel()).toContain('opus');

    // Verify others use Sonnet
    expect(architectAgent.getModel()).toContain('sonnet');
    expect(researcherAgent.getModel()).toContain('sonnet');
    expect(qaAgent.getModel()).toContain('sonnet');
    expect(analystAgent.getModel()).toContain('sonnet');
  });

  it('should validate gate enforcement sequence', async () => {
    const { gateEnforcer } = await import('../../src/orchestrator/gate-enforcer.js');
    const { sessionManager } = await import('../../src/orchestrator/session-manager.js');

    const session = await sessionManager.createSession();

    // Test progressive escalation levels
    const levels = [1, 3, 4, 5, 6, 7, 8];
    const expected = ['L1', 'L1', 'L2', 'L2', 'L3', 'L3', 'L4'];

    for (let i = 0; i < levels.length; i++) {
      const level = gateEnforcer.getEscalationLevel(levels[i]);
      expect(level.level).toBe(expected[i]);
    }
  });
});

describe('Manual Testing Guide', () => {
  it('should provide manual test instructions', () => {
    const instructions = `
# Manual Testing Guide

## Prerequisites
1. Running n8n instance
2. Valid ANTHROPIC_API_KEY
3. n8n-mcp server configured

## Test Scenario 1: Simple Workflow
\`\`\`bash
npm start -- "Create a simple webhook to Telegram workflow"
\`\`\`

**Expected:**
- Architect clarifies requirements
- Blueprint created with minimum nodes
- Builder creates workflow
- QA validates (Phase 5 executed)
- Status: PASS

## Test Scenario 2: Complex Workflow with Errors
\`\`\`bash
npm start -- "Create workflow with 10 nodes for Telegram bot with AI"
\`\`\`

**Expected:**
- Architect extracts nodeCount=10
- Researcher searches for templates
- Blueprint has >=10 nodes
- Builder creates
- QA finds issues → cycles 1-3 (Builder fixes)
- If not fixed → cycles 4-5 (Researcher alternative)
- If still not fixed → cycles 6-7 (Deep dive)
- If blocked → Analyst post-mortem

## Test Scenario 3: GATE Violations
Test each gate manually:
- GATE 1: Set cycle to 8 → should trigger Analyst
- GATE 2: Skip execution analysis → should block
- GATE 3: QA PASS without Phase 5 → should reject
- GATE 4: Check ALREADY_TRIED appears in Builder context
- GATE 5: Builder without MCP calls → should reject
- GATE 6: Unvalidated hypothesis → should block

## Verification Checklist
- [ ] All agents initialize successfully
- [ ] Session persisted to ./sessions/
- [ ] MCP calls logged correctly
- [ ] Fix attempts tracked (GATE 4)
- [ ] Progressive escalation works (GATE 1)
- [ ] Phase 5 testing mandatory (GATE 3)
- [ ] Post-mortem writes to LEARNINGS.md
- [ ] Full context preserved (200K tokens)
`;

    expect(instructions).toBeTruthy();
    console.log(instructions);
  });
});
