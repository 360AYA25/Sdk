# Plan: Integrate External Test Workflow into SDK Agent System

## Context

**Problem:** Currently QA agent validates workflow structure but doesn't test real user interaction. We have a separate "Bot Test Automation" workflow (`vZ5LnF6GXIIiJ8ku`) that can send actual Telegram messages and verify bot responses.

**Goal:** After agents apply fixes/features to the main workflow, automatically trigger the test workflow to verify changes work in real conditions.

## Current State

### Test Workflow (`vZ5LnF6GXIIiJ8ku`)
- **Endpoint:** `https://n8n.srv1068954.hstgr.cloud/webhook/bot-test` (POST)
- **Input:**
  ```json
  {
    "bot_username": "@Multi_Bot0101_bot",
    "task": "Test that the bot responds to food logging",
    "scope": "food_entry"
  }
  ```
- **Process:** OpenAI generates test cases → Telethon sends to bot → Validates response
- **Output:**
  ```json
  {
    "run_id": "2025-12-28-...",
    "total_tests": 1,
    "passed": 1,
    "failed": 0,
    "success_rate": "100.0%",
    "results": [...]
  }
  ```

### Current SDK Flow
```
Builder fixes → QA validates (structure) → PASS/FAIL
```

### Proposed Flow
```
Builder fixes → QA validates (structure) → External Test → Real PASS/FAIL
```

---

## Implementation Plan

### Phase 1: Add External Tester Module

**New file:** `src/orchestrator/external-tester.ts`

```typescript
export interface ExternalTestConfig {
  testWorkflowId: string;           // vZ5LnF6GXIIiJ8ku
  webhookUrl: string;               // Full webhook URL
  botUsername: string;              // @Multi_Bot0101_bot
  timeout: number;                  // 30000ms default
}

export interface ExternalTestRequest {
  task: string;                     // What to test (from fix description)
  scope: string;                    // Affected area (from affected nodes)
  message?: string;                 // Optional specific test message
}

export interface ExternalTestResult {
  success: boolean;
  passed: number;
  failed: number;
  successRate: string;
  results: Array<{
    test_id: string;
    passed: boolean;
    message_sent: string;
    response_received: string;
    expected_pattern: string;
  }>;
  error?: string;
}

export class ExternalTester {
  constructor(config: ExternalTestConfig);

  async runTests(request: ExternalTestRequest): Promise<ExternalTestResult>;

  // Generate test task from analysis findings
  buildTestTask(
    fixDescription: string,
    affectedNodes: string[]
  ): ExternalTestRequest;
}
```

### Phase 2: Integrate into Orchestrator

**Modify:** `src/orchestrator/index.ts`

Add new stage after QA validation:

```typescript
// After QA PASS but before final completion
if (qaResult.status === 'PASS' && externalTester.isConfigured()) {
  console.log('[EXTERNAL TEST] Running real bot tests...');

  const testRequest = externalTester.buildTestTask(
    session.lastFix?.description || task,
    session.lastFix?.affectedNodes || []
  );

  const testResult = await externalTester.runTests(testRequest);

  if (!testResult.success || testResult.failed > 0) {
    // Real test failed - escalate
    session.stage = 'qa';
    session.cycle++;
    qaResult.status = 'FAIL';
    qaResult.external_test_failed = true;
    qaResult.test_results = testResult;
  }
}
```

### Phase 3: Configuration

**Add to:** `.env.example`
```bash
# External Test Workflow (optional)
EXTERNAL_TEST_WORKFLOW_ID=vZ5LnF6GXIIiJ8ku
EXTERNAL_TEST_WEBHOOK_URL=https://n8n.srv1068954.hstgr.cloud/webhook/bot-test
EXTERNAL_TEST_BOT_USERNAME=@Multi_Bot0101_bot
EXTERNAL_TEST_ENABLED=true
```

### Phase 4: Task-to-Test Mapping

The key challenge is generating appropriate test tasks from fix descriptions.

**Logic in `buildTestTask()`:**

```typescript
buildTestTask(fixDescription: string, affectedNodes: string[]): ExternalTestRequest {
  // Map affected nodes to scopes
  const scopeMap: Record<string, string> = {
    'AI Agent': 'ai_response',
    'Save Food Entry': 'food_entry',
    'Log Water Intake': 'water_logging',
    'Vision Analysis': 'photo_analysis',
    'Transcribe Voice': 'voice_input',
    'Get Daily Summary': 'daily_summary',
  };

  const scope = affectedNodes
    .map(node => scopeMap[node])
    .filter(Boolean)[0] || 'general';

  return {
    task: `Verify fix: ${fixDescription}`,
    scope: scope,
  };
}
```

---

## Flow Diagram

```
User Request
     ↓
  ANALYZE (existing)
     ↓
  [A] Auto-fix selected
     ↓
  orchestrator.start(fixTask)
     ↓
  ┌─────────────────────────────────────────┐
  │  Architect → Researcher → Builder → QA  │
  │              (existing flow)            │
  └─────────────────────────────────────────┘
     ↓
  QA returns PASS
     ↓
  ┌─────────────────────────────────────────┐
  │  GATE 7: External Test (MANDATORY)       │
  │  1. Build test task from fix context     │
  │  2. POST to Bot Test Automation webhook  │
  │  3. Telethon sends real Telegram message │
  │  4. Wait for bot response (3s)           │
  │  5. Validate response against pattern    │
  └─────────────────────────────────────────┘
     ↓
  Tests PASS → COMPLETE ✓
     ↓ FAIL
  Researcher analyzes failure
     ↓
  Builder applies fix
     ↓
  (repeat from QA)
```

### GATE 7: External Real-World Testing

**Rule:** QA PASS is not final until external tests pass.

```typescript
// New gate in gate-enforcer.ts
async checkExternalTest(testResult: ExternalTestResult): Promise<GateResult> {
  if (testResult.failed > 0) {
    return {
      passed: false,
      message: `External test failed: ${testResult.failed}/${testResult.passed + testResult.failed} tests failed`,
      escalateTo: 'researcher'  // L2 escalation
    };
  }
  return { passed: true };
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/orchestrator/external-tester.ts` | CREATE | External test runner module |
| `src/orchestrator/index.ts` | MODIFY | Add GATE 7 external test after QA PASS |
| `src/orchestrator/gate-enforcer.ts` | MODIFY | Add GATE 7: checkExternalTest() |
| `src/types.ts` | MODIFY | Add ExternalTestResult, ExternalTestConfig types |
| `.env.example` | MODIFY | Add external test configuration |
| `config/gates.json` | MODIFY | Add GATE 7 definition |

---

## User Decisions

1. **External testing is MANDATORY** - фикс не считается завершённым без реального теста
2. **On test failure → Escalate to Researcher** - нужен анализ причин провала

---

## Updated Escalation Logic

```
QA PASS → External Test
                ↓
         Test PASSED? ──────→ COMPLETE
                ↓ NO
         Researcher analyzes test failure
                ↓
         Builder applies fix
                ↓
         QA validates → External Test (repeat)
```

**Key change:** External test failure is treated as L2 escalation (Researcher needed), not L1 (Builder only).

---

## Modified Orchestrator Logic

```typescript
// In orchestrator after QA PASS
if (qaResult.status === 'PASS') {
  console.log('[EXTERNAL TEST] Running MANDATORY real bot tests...');

  const testResult = await externalTester.runTests(testRequest);

  if (!testResult.success || testResult.failed > 0) {
    // External test failed - ESCALATE TO RESEARCHER
    console.log('[EXTERNAL TEST] FAILED - Escalating to Researcher');

    // Add test failure context to session
    session.externalTestResult = testResult;
    session.stage = 'research';  // L2 escalation
    session.cycle++;

    // Researcher will analyze why the real test failed
    // Then Builder will apply fix based on Researcher's analysis
  }
}
```

---

## Edge Cases

1. **Test workflow not available:** BLOCK workflow completion, require config
2. **Test timeout:** Treat as FAIL, escalate to Researcher
3. **Telethon service down:** BLOCK and notify user
4. **No matching scope:** Use "general" scope for broad test
