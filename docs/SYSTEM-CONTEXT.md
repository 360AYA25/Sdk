# System Context

## Current Status
SDK Migration in progress.

## Active Sessions
None.

## Recent Issues
None.

## Notes
This file is auto-updated by the Analyst agent.

## Orchestrator Flow Control

## Orchestrator Flow Control

### Handling Non-Workflow Requests
The orchestrator must detect when user requests are conversational rather than workflow-building tasks:
1. Greetings/Help: Return helpful information without attempting to build
2. Clarifying Questions: Engage in dialog, don't force build path
3. List/Read Operations: Execute read-only operations, don't create workflows

### Blueprint Validation (GATE 2)
Before invoking Builder:
- Validate blueprint is non-empty
- Check required fields: workflow_name, nodes (array with length > 0)
- Verify credentials_needed field exists (can be empty array)
- BLOCK if validation fails

## Known False Positives

### Webhook responseNode onError False Positive

**Error Message**: 'responseNode mode requires onError: continueRegularOutput'
**Condition**: When webhook already has parameters.options.onError = 'continueRegularOutput'
**Action**: Ignore validation error - configuration is already correct
**Pattern**: Validation system doesn't properly recognize nested onError configuration in options object

## Known Validation Conflicts

**Manual Trigger + Code Node Deadlock**
- L-100 mandates Phase 5 testing for Code nodes
- Manual Triggers cannot be automatically tested
- Results in legitimate GATE 3 violation → BLOCKED status
- Resolution requires user intervention or design change
- This is correct system behavior, not a bug

## Known Issues

**Hardcoded Validation Anti-Pattern**: Code nodes with hardcoded field validation (like checking for specific field names) frequently fail when webhook payloads have different structures. Always examine actual payload structure before implementing validation logic. This caused workflow SgHwhcgcr3bOFIdI to fail with 12+ failed executions.

## Testing Requirements

**Phase 5 Realistic Data Requirement**: All webhook-triggered workflows must be tested with payloads that match the actual expected input structure, not generic test data. Validation logic must be tested against real-world data schemas.

## Session Management

Pre-flight Failures (Cycle 0 Blocks): When sessions block at cycle 0, investigate: user requirement clarity, scope determination capability, system health, and domain appropriateness. These failures waste fewer tokens but indicate process issues at the requirement gathering stage.
