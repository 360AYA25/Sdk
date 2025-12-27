# Analyze Mode Design

## Overview

Расширение SDK для глубокого анализа существующих workflows.
Использует Researcher + Analyst агентов для аудита.

## Architecture

```
orchestrator.analyze(workflowId)
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: RESEARCHER - Deep Node Audit                       │
│                                                              │
│ For each node in workflow:                                   │
│   1. get_node(nodeType, detail="standard")                  │
│   2. Compare with workflow config                            │
│   3. Check typeVersion (outdated?)                          │
│   4. Validate parameters vs schema                          │
│   5. Flag deprecated/problematic patterns                    │
│                                                              │
│ Also:                                                        │
│   - validate_workflow (structure)                            │
│   - n8n_executions (last 20, find errors)                   │
│   - Check connections for orphan nodes                       │
└─────────────────────────────────────────────────────────────┘
    ↓
    Returns: NodeAudit[] + ExecutionAnalysis + StructureIssues
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: ANALYST - Report Generation                        │
│                                                              │
│   1. Prioritize issues (P0/P1/P2)                           │
│   2. Root cause analysis per issue                          │
│   3. Generate fix recommendations                            │
│   4. Estimate effort per fix                                 │
│   5. Create implementation plan                              │
│   6. Write to ANALYSIS-{date}.md                            │
└─────────────────────────────────────────────────────────────┘
    ↓
    Returns: AuditReport (structured + markdown)
```

## New Types (types.ts)

```typescript
// ============================================
// Analyze Mode Types
// ============================================

export type AnalyzeStage =
  | 'audit_nodes'
  | 'audit_executions'
  | 'audit_structure'
  | 'generate_report'
  | 'complete';

export interface NodeAudit {
  nodeName: string;
  nodeType: string;
  typeVersion: number;
  latestVersion: number;
  isOutdated: boolean;
  issues: NodeIssue[];
  suggestions: string[];
}

export interface NodeIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  code: string;
  message: string;
  fix?: string;
  effort: 'trivial' | 'small' | 'medium' | 'large';
}

export interface ExecutionAnalysis {
  totalExecutions: number;
  successRate: number;
  recentErrors: ExecutionError[];
  problematicNodes: string[];
  patterns: ErrorPattern[];
}

export interface ExecutionError {
  executionId: string;
  timestamp: Date;
  nodeName: string;
  errorType: string;
  message: string;
}

export interface ErrorPattern {
  pattern: string;
  frequency: number;
  affectedNodes: string[];
  suggestedFix: string;
}

export interface StructureIssue {
  type: 'orphan_node' | 'dead_end' | 'circular' | 'missing_connection' | 'routing_issue';
  nodeName?: string;
  description: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface AuditReport {
  workflowId: string;
  workflowName: string;
  analyzedAt: Date;
  summary: {
    totalNodes: number;
    outdatedNodes: number;
    criticalIssues: number;
    highIssues: number;
    successRate: number;
  };
  nodeAudits: NodeAudit[];
  executionAnalysis: ExecutionAnalysis;
  structureIssues: StructureIssue[];
  recommendations: Recommendation[];
  implementationPlan: ImplementationStep[];
}

export interface Recommendation {
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  description: string;
  affectedNodes: string[];
  effort: string;
  impact: string;
}

export interface ImplementationStep {
  phase: number;
  title: string;
  tasks: string[];
  estimatedEffort: string;
  dependencies: number[];
}
```

## Researcher Extension

```typescript
// In researcher.ts - new method

/**
 * Audit workflow nodes deeply
 * Uses get_node for each node to check versions, schemas, best practices
 */
async auditWorkflow(
  session: SessionContext,
  workflowId: string
): Promise<{
  nodeAudits: NodeAudit[];
  executionAnalysis: ExecutionAnalysis;
  structureIssues: StructureIssue[];
}> {
  const result = await this.invoke(
    session,
    `Deep audit of workflow ${workflowId}`,
    {
      workflowId,
      instruction: `Execute Deep Workflow Audit:

## PHASE 1: Get Workflow
Call n8n_get_workflow(id="${workflowId}", mode="details")
Note: node count, connections, active status

## PHASE 2: Audit Each Node
For EACH node in workflow:
1. Call get_node(nodeType, detail="standard")
2. Compare typeVersion with latest
3. Check if parameters match schema
4. Look for deprecated patterns
5. Check for missing required fields

## PHASE 3: Analyze Executions
1. Call n8n_executions(action="list", workflowId, status="error", limit=20)
2. For each failed execution: n8n_executions(action="get", id, mode="summary")
3. Identify patterns in failures
4. Find most problematic nodes

## PHASE 4: Check Structure
1. Find orphan nodes (not connected)
2. Find dead ends (no output used)
3. Check routing logic (Switch nodes)
4. Validate connection types

Return JSON:
{
  "nodeAudits": [
    {
      "nodeName": "AI Agent",
      "nodeType": "@n8n/n8n-nodes-langchain.agent",
      "typeVersion": 2.2,
      "latestVersion": 2.3,
      "isOutdated": true,
      "issues": [
        {
          "severity": "medium",
          "code": "OUTDATED_VERSION",
          "message": "Node version 2.2 is outdated, latest is 2.3",
          "fix": "Update typeVersion to 2.3",
          "effort": "trivial"
        }
      ],
      "suggestions": ["Consider using structured output"]
    }
  ],
  "executionAnalysis": {
    "totalExecutions": 100,
    "successRate": 0.85,
    "recentErrors": [...],
    "problematicNodes": ["Send Keyboard (HTTP)"],
    "patterns": [...]
  },
  "structureIssues": [
    {
      "type": "routing_issue",
      "nodeName": "Week Calculations Code",
      "description": "Node receives data from all AI commands, not just /week",
      "severity": "high"
    }
  ]
}`,
    }
  );

  return result.data as {
    nodeAudits: NodeAudit[];
    executionAnalysis: ExecutionAnalysis;
    structureIssues: StructureIssue[];
  };
}
```

## Analyst Extension

```typescript
// In analyst.ts - new method

/**
 * Generate comprehensive audit report
 */
async generateAuditReport(
  session: SessionContext,
  auditData: {
    nodeAudits: NodeAudit[];
    executionAnalysis: ExecutionAnalysis;
    structureIssues: StructureIssue[];
  },
  workflowId: string,
  workflowName: string
): Promise<AuditReport> {
  const result = await this.invoke(
    session,
    'Generate audit report from findings',
    {
      auditData,
      workflowId,
      workflowName,
      instruction: `Generate Comprehensive Audit Report:

## INPUT DATA
- ${auditData.nodeAudits.length} nodes audited
- ${auditData.executionAnalysis.recentErrors.length} recent errors
- ${auditData.structureIssues.length} structure issues

## ANALYSIS TASKS

1. PRIORITIZE ISSUES
   - P0: Causes failures, blocks functionality
   - P1: Degraded experience, potential failures
   - P2: Improvements, best practices

2. ROOT CAUSE ANALYSIS
   For each P0/P1 issue, explain WHY it's happening

3. RECOMMENDATIONS
   For each issue:
   - What to fix
   - How to fix (specific steps)
   - Effort estimate
   - Impact if not fixed

4. IMPLEMENTATION PLAN
   - Group fixes by dependency
   - Order by priority
   - Estimate total effort

Return JSON:
{
  "workflowId": "${workflowId}",
  "workflowName": "${workflowName}",
  "analyzedAt": "2025-12-27T...",
  "summary": {
    "totalNodes": N,
    "outdatedNodes": N,
    "criticalIssues": N,
    "highIssues": N,
    "successRate": 0.XX
  },
  "recommendations": [
    {
      "priority": "P0",
      "title": "Fix empty text in Send Keyboard",
      "description": "...",
      "affectedNodes": ["Send Keyboard (HTTP)"],
      "effort": "5 minutes",
      "impact": "Prevents 100% of send failures"
    }
  ],
  "implementationPlan": [
    {
      "phase": 1,
      "title": "Critical Fixes",
      "tasks": ["Add fallback text", "..."],
      "estimatedEffort": "30 minutes",
      "dependencies": []
    }
  ]
}`,
    }
  );

  return result.data as AuditReport;
}

/**
 * Write audit report to file
 */
async writeAuditReport(
  report: AuditReport,
  outputPath: string
): Promise<boolean> {
  const markdown = this.formatAuditReportMarkdown(report);

  try {
    await fs.writeFile(outputPath, markdown);
    console.log(`[Analyst] Audit report written to ${outputPath}`);
    return true;
  } catch (error) {
    console.error('[Analyst] Failed to write audit report:', error);
    return false;
  }
}

private formatAuditReportMarkdown(report: AuditReport): string {
  // Convert structured report to readable markdown
  // ... implementation
}
```

## Orchestrator Extension

```typescript
// In orchestrator/index.ts - new method

/**
 * Analyze existing workflow (new mode)
 */
async analyze(workflowId: string): Promise<AuditReport> {
  // Create analysis session
  this.session = await sessionManager.createSession(workflowId);
  this.session.stage = 'audit_nodes' as Stage;

  console.log(`[Orchestrator] Starting analysis of workflow ${workflowId}`);

  try {
    // Phase 1: Researcher audits workflow
    await researcherAgent.initialize();
    const auditData = await researcherAgent.auditWorkflow(
      this.session,
      workflowId
    );

    console.log(`[Orchestrator] Audit complete: ${auditData.nodeAudits.length} nodes`);

    // Get workflow name
    // (would need to fetch from auditData or make separate call)
    const workflowName = 'FoodTracker'; // simplified

    // Phase 2: Analyst generates report
    await analystAgent.initialize();
    const report = await analystAgent.generateAuditReport(
      this.session,
      auditData,
      workflowId,
      workflowName
    );

    // Write report
    const outputPath = `./reports/ANALYSIS-${workflowId}-${Date.now()}.md`;
    await analystAgent.writeAuditReport(report, outputPath);

    // Archive session
    await sessionManager.archiveSession(this.session.id);

    return report;
  } catch (error) {
    console.error('[Orchestrator] Analysis failed:', error);
    throw error;
  }
}
```

## Usage

```bash
# CLI
npm start -- --analyze sw3Qs3Fe3JahEbbW

# Or programmatic
import { orchestrator } from './src/index.js';

const report = await orchestrator.analyze('sw3Qs3Fe3JahEbbW');
console.log(report.summary);
console.log(report.recommendations);
```

## Files to Modify

1. `src/types.ts` - Add Analyze types
2. `src/agents/researcher.ts` - Add auditWorkflow()
3. `src/agents/analyst.ts` - Add generateAuditReport(), writeAuditReport()
4. `src/orchestrator/index.ts` - Add analyze()
5. `src/index.ts` - Handle --analyze CLI arg
6. `src/shared/prompts/researcher.md` - Add audit instructions
7. `src/shared/prompts/analyst.md` - Add report generation instructions

## Estimated Effort

| Task | Effort |
|------|--------|
| Add types | 30 min |
| Extend Researcher | 1 hour |
| Extend Analyst | 1 hour |
| Extend Orchestrator | 30 min |
| Update prompts | 30 min |
| Testing | 1 hour |
| **Total** | **4-5 hours** |

## Benefits

1. **Deep Node Analysis** - не просто validate_workflow, а get_node для каждой ноды
2. **Version Tracking** - находит outdated nodes
3. **Pattern Detection** - анализирует executions на patterns
4. **Structured Output** - JSON + Markdown report
5. **Reusable** - работает для любого workflow
