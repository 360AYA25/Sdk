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
