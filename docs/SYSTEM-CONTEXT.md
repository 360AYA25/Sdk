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

## HTTP Request Node Configuration Issues

**Issue**: 405 Method Not Allowed errors in production workflows
**Cause**: HTTP method mismatch between n8n configuration and external API requirements
**Impact**: Runtime workflow failures, disrupted automation
**Fix**: Verify API documentation and test endpoints before deployment
**Prevention**: Add HTTP method validation to pre-deployment checklist



### External API Dependencies

**Issue**: Workflows with external API dependencies can fail when those APIs change or become unavailable.

**Symptoms**: 
- 405 Method Not Allowed errors
- Connection timeouts to external services
- Workflow executes successfully until external API call

**Mitigation**:
- Implement API health checks before main workflow execution
- Add error handling for external API failures
- Use retry mechanisms with exponential backoff
- Document external API dependencies and monitor their status

**Example**: Bot Test Automation workflow failing on http://72.60.28.252:5001/get_last_message endpoint



External HTTP service dependencies can cause workflow execution cascades. Monitor for patterns like '20+ consecutive failures with same error' which indicate service-level issues rather than workflow logic problems. The asyncio event loop error in Telethon services requires service restart, not workflow changes.



**Hardcoded Validation Anti-Pattern**: Code nodes with hardcoded field validation (like checking for specific field names) frequently fail when webhook payloads have different structures. Always examine actual payload structure before implementing validation logic. This caused workflow SgHwhcgcr3bOFIdI to fail with 12+ failed executions.

## Testing Requirements

**Phase 5 Realistic Data Requirement**: All webhook-triggered workflows must be tested with payloads that match the actual expected input structure, not generic test data. Validation logic must be tested against real-world data schemas.

## Session Management

Pre-flight Failures (Cycle 0 Blocks): When sessions block at cycle 0, investigate: user requirement clarity, scope determination capability, system health, and domain appropriateness. These failures waste fewer tokens but indicate process issues at the requirement gathering stage.

## Error Patterns

HTTP Request node failures with 500 errors and 'asyncio event loop must not change' indicate external service configuration issues. These require infrastructure fixes, not workflow modifications. Implement proper error handling with 'Continue on Error' option and retry mechanisms.
