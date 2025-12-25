# Validation Gates Documentation

## Overview

6 validation gates ensure system reliability and prevent common failure modes.
All gates from the original `validation-gates.md` are preserved.

## GATE 1: Progressive Escalation

**Purpose:** Ensure proper escalation based on cycle count

**Rules:**
- Cycles 1-3: Builder direct fix (L1)
- Cycles 4-5: Researcher alternative approach (L2)
- Cycles 6-7: Researcher deep dive (L3)
- Cycle 8+: BLOCKED → Analyst post-mortem (L4)

**Implementation:**
```typescript
// gate-enforcer.ts
async checkProgressiveEscalation(session, targetAgent) {
  if (cycle >= 8) {
    return { passed: false, message: "L4 escalation required" };
  }
  if (cycle >= 4 && targetAgent === 'builder' && !researcherCalled) {
    return { passed: false, message: "Researcher required before Builder" };
  }
  return { passed: true };
}
```

---

## GATE 2: Execution Analysis Requirement

**Purpose:** Require L-067 two-step analysis before Builder fix

**Rules:**
- If there's a failed execution, Researcher must analyze first
- Must use mode="summary" then mode="filtered"
- Never use mode="full" for >10 nodes

**Implementation:**
```typescript
async checkExecutionAnalysis(session, hasFailedExecution) {
  if (!hasFailedExecution) return { passed: true };

  // Check for L-067 compliance
  const hasTwoStep = session.mcpCalls.some(c =>
    c.tool === 'n8n_executions' && c.params.mode === 'summary'
  ) && session.mcpCalls.some(c =>
    c.tool === 'n8n_executions' && c.params.mode === 'filtered'
  );

  if (!hasTwoStep) {
    return { passed: false, message: "L-067 analysis required" };
  }
  return { passed: true };
}
```

---

## GATE 3: Phase 5 Real Testing

**Purpose:** Ensure QA PASS includes actual workflow execution

**Rules:**
- QA cannot return status="PASS" without phase_5_executed=true
- Must call n8n_test_workflow or verify execution
- No theoretical validation only

**Implementation:**
```typescript
async checkPhase5Testing(qaReport) {
  if (qaReport.status !== 'PASS') {
    return { passed: true }; // Only applies to PASS
  }

  if (!qaReport.phase_5_executed) {
    return {
      passed: false,
      message: "QA PASS requires Phase 5 testing"
    };
  }
  return { passed: true };
}
```

---

## GATE 4: Fix Attempts History

**Purpose:** Prevent repeating failed approaches

**Rules:**
- All fix attempts tracked in session
- Automatically injected as ALREADY_TRIED section
- Builder must not repeat approaches from this list

**Implementation:**
```typescript
// session-manager.ts
async formatAlreadyTried(sessionId) {
  const attempts = await this.getFixAttempts(sessionId);
  if (!attempts.length) return '';

  let section = '## ALREADY TRIED (DO NOT REPEAT!)\n\n';
  for (const attempt of attempts) {
    section += `### Cycle ${attempt.cycle}: ${attempt.approach}\n`;
    section += `- Result: ${attempt.result}\n`;
  }
  return section;
}
```

---

## GATE 5: MCP Call Verification

**Purpose:** Ensure Builder actually made MCP mutations

**Rules:**
- Builder must log mcp_calls array
- At least one mutation call required
- Prevents "claimed success" without actual work

**Implementation:**
```typescript
async verifyMCPCalls(session, agentRole) {
  if (agentRole !== 'builder') return { passed: true };

  const calls = await sessionManager.getMCPCalls(session.id, 'builder');

  if (!calls || calls.length === 0) {
    return { passed: false, message: "No MCP calls logged" };
  }

  if (!calls.some(c => c.type === 'mutation')) {
    return { passed: false, message: "No mutation calls" };
  }

  return { passed: true, data: { calls: calls.length } };
}
```

---

## GATE 6: Hypothesis Validation

**Purpose:** Ensure Researcher validates hypotheses before proposal

**Rules:**
- Researcher must provide hypothesis
- hypothesis_validated must be true
- Prevents untested assumptions

**Implementation:**
```typescript
async validateHypothesis(session, findings) {
  if (!findings.hypothesis) {
    return { passed: false, message: "Hypothesis required" };
  }

  if (!findings.hypothesis_validated) {
    return {
      passed: false,
      message: "Hypothesis must be validated"
    };
  }

  return { passed: true };
}
```

---

## Gate Enforcement Points

| Gate | When Checked | Enforcer |
|------|-------------|----------|
| GATE 1 | Before any agent call | Orchestrator |
| GATE 2 | Before Builder fix | Orchestrator |
| GATE 3 | After QA returns PASS | Orchestrator |
| GATE 4 | Automatic injection | SessionManager |
| GATE 5 | After Builder returns | Orchestrator |
| GATE 6 | Before decision stage | Orchestrator |

## Violation Handling

When a gate fails:
1. Log violation with context
2. Trigger Analyst if appropriate
3. Return blocking message to orchestrator
4. Orchestrator handles recovery/escalation

```typescript
interface GateViolation {
  gate: string;
  reason: string;
  context: Record<string, unknown>;
  timestamp: Date;
}
```

## Testing Gates

```typescript
// Example test
describe('GATE 3', () => {
  it('blocks PASS without Phase 5', async () => {
    const report = { status: 'PASS', phase_5_executed: false };
    const result = await gateEnforcer.checkPhase5Testing(report);
    expect(result.passed).toBe(false);
  });
});
```
