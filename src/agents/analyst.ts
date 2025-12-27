/**
 * Analyst Agent
 * Post-mortem ONLY (L4) + token tracking
 *
 * Responsibilities:
 * - Post-mortem analysis (after stage=blocked)
 * - Timeline reconstruction
 * - Agent grading (1-10)
 * - Token usage tracking
 * - Learning extraction (L-XXX)
 * - Write to LEARNINGS.md (only write operation!)
 * - Context update (SYSTEM-CONTEXT.md)
 *
 * Triggers:
 * - Auto-trigger on GATE 1 violation (cycle >= 8)
 * - Manual trigger via L4 escalation
 */

import { promises as fs } from 'fs';
import path from 'path';
import { BaseAgent } from './base-agent.js';
import type {
  SessionContext,
  MCPCall,
  AnalystReport,
  TimelineEntry,
  TokenUsage,
  ProposedLearning,
  ContextUpdate,
  AgentRole,
  AgentMode,
  AnalysisReport,
  AgentMessage,
  ReportFinding,
  Recommendation,
  RoadmapItem,
} from '../types.js';
import type { SharedContextStore } from '../shared/context-store.js';
import type { MessageCoordinator } from '../shared/message-protocol.js';

// Paths relative to sdk-migration directory
const LEARNINGS_PATH = path.resolve(process.cwd(), 'docs', 'learning', 'LEARNINGS.md');
const CONTEXT_PATH = path.resolve(process.cwd(), 'docs', 'SYSTEM-CONTEXT.md');

export class AnalystAgent extends BaseAgent {
  private mode: AgentMode = 'create';

  constructor() {
    super('analyst', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      skills: ['n8n-workflow-patterns', 'n8n-validation-expert'],
      mcpTools: [
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_list_workflows',
        'mcp__n8n-mcp__n8n_executions',
        'mcp__n8n-mcp__n8n_workflow_versions',
        'mcp__n8n-mcp__n8n_validate_workflow',
      ],
      promptFile: 'analyst.md',
      indexFile: 'analyst_learnings.md',
      writePermissions: ['docs/learning/LEARNINGS.md', 'docs/SYSTEM-CONTEXT.md'],
    });
  }

  /**
   * Set operating mode - changes behavior and prompts
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;

    if (mode === 'analyze') {
      this.config.promptFile = 'analyst-analyze.md';
    } else {
      this.config.promptFile = 'analyst.md';
    }
  }

  /**
   * Get current mode
   */
  getMode(): AgentMode {
    return this.mode;
  }

  /**
   * Process result from Agent SDK
   */
  protected async processResult(
    result: string,
    session: SessionContext,
    mcpCalls: MCPCall[]
  ): Promise<AnalystReport> {
    return this.parseAnalystReport(result, session);
  }

  /**
   * Parse analyst report
   */
  private parseAnalystReport(
    content: string,
    session: SessionContext
  ): AnalystReport {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as AnalystReport;
      } catch {
        // Fall through
      }
    }

    return {
      root_cause: content,
      timeline: [],
      agent_grades: {} as Record<AgentRole, number>,
      token_usage: { total: 0, byAgent: {} as Record<AgentRole, number>, byCycle: [] },
      proposed_learnings: [],
      context_updates: [],
    };
  }

  /**
   * Full post-mortem analysis
   */
  async postMortem(
    session: SessionContext,
    workflowId: string
  ): Promise<AnalystReport> {
    const result = await this.invoke(
      session,
      `Post-mortem analysis for blocked workflow ${workflowId}`,
      {
        workflowId,
        sessionId: session.id,
        cycle: session.cycle,
        instruction: `Conduct L4 Post-Mortem Analysis:

## 1. Timeline Reconstruction
- Review all agent actions
- Identify decision points
- Map failure progression

## 2. Root Cause Analysis
- What fundamentally went wrong?
- Was it preventable?
- What information was missing?

## 3. Agent Grading (1-10)
Grade each agent on their performance:
- architect: Requirements clarity?
- researcher: Search quality? Hypothesis validation?
- builder: Code quality? Protocol compliance?
- qa: Testing thoroughness? False positive handling?

## 4. Token Usage
- Calculate total tokens used
- Break down by agent
- Identify waste

## 5. Learning Extraction
- Propose new L-XXX learnings
- Suggest LEARNINGS.md additions
- Recommend SYSTEM-CONTEXT.md updates

Return JSON:
{
  "root_cause": "...",
  "timeline": [{"timestamp": "...", "agent": "...", "action": "...", "result": "..."}],
  "agent_grades": {"architect": 7, "researcher": 8, "builder": 5, "qa": 6, "analyst": 8},
  "token_usage": {"total": 50000, "byAgent": {...}, "byCycle": [...]},
  "proposed_learnings": [{"id": "L-XXX", "title": "...", "content": "...", "category": "...", "severity": "critical"}],
  "context_updates": [{"file": "SYSTEM-CONTEXT.md", "section": "...", "content": "..."}]
}`,
      }
    );

    return result.data as AnalystReport;
  }

  /**
   * Analyze single cycle failure
   */
  async analyzeCycle(
    session: SessionContext,
    cycleNumber: number
  ): Promise<{
    issue: string;
    recommendation: string;
    escalationNeeded: boolean;
  }> {
    const result = await this.invoke(
      session,
      `Analyze cycle ${cycleNumber} failure`,
      {
        cycleNumber,
        instruction: `Quick cycle analysis:
1. What went wrong this cycle?
2. What should be tried next?
3. Is escalation needed?

Return JSON:
{
  "issue": "...",
  "recommendation": "...",
  "escalationNeeded": true/false
}`,
      }
    );

    return result.data as {
      issue: string;
      recommendation: string;
      escalationNeeded: boolean;
    };
  }

  /**
   * Calculate token usage
   */
  async calculateTokenUsage(session: SessionContext): Promise<TokenUsage> {
    const history = await this.getSessionHistory(session);

    const byAgent: Record<AgentRole, number> = {
      architect: 0,
      researcher: 0,
      builder: 0,
      qa: 0,
      analyst: 0,
    };

    const byCycle: number[] = [];
    let currentCycle = 0;
    let cycleTokens = 0;

    for (const entry of history) {
      const tokens = entry.tokens || Math.ceil(entry.content.length / 4);

      if (entry.agentRole) {
        byAgent[entry.agentRole] += tokens;
      }

      // Track by cycle (simplified)
      cycleTokens += tokens;
    }

    byCycle.push(cycleTokens);

    const total = Object.values(byAgent).reduce((a, b) => a + b, 0);

    return { total, byAgent, byCycle };
  }

  /**
   * Get session history (helper)
   */
  private async getSessionHistory(session: SessionContext) {
    return session.history;
  }

  /**
   * Write learning to LEARNINGS.md
   */
  async writeLearning(learning: ProposedLearning): Promise<boolean> {
    try {
      const currentContent = await fs.readFile(LEARNINGS_PATH, 'utf-8');

      // Find next L-XXX number
      const matches = currentContent.match(/L-(\d{3})/g) || [];
      const numbers = matches.map(m => parseInt(m.replace('L-', '')));
      const nextNumber = Math.max(...numbers, 0) + 1;
      const newId = `L-${String(nextNumber).padStart(3, '0')}`;

      // Format learning entry
      const entry = `

### ${newId}: ${learning.title}

**Category:** ${learning.category}
**Severity:** ${learning.severity}
**Added:** ${new Date().toISOString().split('T')[0]}

${learning.content}

---`;

      // Append to file
      await fs.writeFile(LEARNINGS_PATH, currentContent + entry);

      console.log(`Written learning ${newId}: ${learning.title}`);
      return true;
    } catch (error) {
      console.error('Failed to write learning:', error);
      return false;
    }
  }

  /**
   * Update SYSTEM-CONTEXT.md
   */
  async updateContext(update: ContextUpdate): Promise<boolean> {
    try {
      const currentContent = await fs.readFile(CONTEXT_PATH, 'utf-8');

      // Find section and update
      const sectionRegex = new RegExp(
        `(## ${update.section}[\\s\\S]*?)(?=## |$)`,
        'm'
      );

      let newContent: string;
      if (sectionRegex.test(currentContent)) {
        // Update existing section
        newContent = currentContent.replace(sectionRegex, `## ${update.section}\n\n${update.content}\n\n`);
      } else {
        // Add new section
        newContent = currentContent + `\n## ${update.section}\n\n${update.content}\n`;
      }

      await fs.writeFile(CONTEXT_PATH, newContent);

      console.log(`Updated SYSTEM-CONTEXT.md section: ${update.section}`);
      return true;
    } catch (error) {
      console.error('Failed to update context:', error);
      return false;
    }
  }

  /**
   * Generate user-facing report
   */
  generateUserReport(report: AnalystReport): string {
    let output = `# Post-Mortem Report

## Root Cause
${report.root_cause}

## Timeline
`;

    for (const entry of report.timeline || []) {
      output += `- **${entry.agent}**: ${entry.action} → ${entry.result}\n`;
    }

    output += `
## Agent Performance
`;

    for (const [agent, grade] of Object.entries(report.agent_grades || {})) {
      const bar = '█'.repeat(grade) + '░'.repeat(10 - grade);
      output += `- ${agent}: ${bar} (${grade}/10)\n`;
    }

    output += `
## Token Usage
- Total: ${(report.token_usage?.total || 0).toLocaleString()} tokens
`;

    output += `
## Recommendations
`;

    for (const learning of report.proposed_learnings || []) {
      output += `- **${learning.title}** (${learning.severity})\n`;
    }

    return output;
  }

  // ============================================
  // ANALYZE MODE METHODS
  // ============================================

  /**
   * Generate analysis report from all agent contributions
   */
  async generateAnalysisReport(
    store: SharedContextStore,
    coordinator: MessageCoordinator
  ): Promise<AnalysisReport> {
    if (this.mode !== 'analyze') {
      throw new Error('generateAnalysisReport only available in ANALYZE mode');
    }

    const workflowData = store.get('workflowData');
    const architectContext = store.get('architectContext');
    const researcherFindings = store.get('researcherFindings');
    const qaExchanges = coordinator.getQAExchanges();

    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'complete',
      cycle: 0,
      startedAt: store.get('startedAt'),
      lastUpdatedAt: new Date(),
      history: [],
      fixAttempts: [],
      mcpCalls: [],
      agentResults: new Map(),
    };

    const result = await this.invoke(
      session,
      'Synthesize analysis report',
      {
        workflowSummary: {
          id: workflowData.id,
          name: workflowData.name,
          nodeCount: workflowData.nodes.length,
          active: workflowData.active,
        },
        architectContext,
        researcherFindings,
        qaExchanges,
        instruction: `## SYNTHESIS TASK

You have findings from Architect and Researcher. Synthesize a comprehensive analysis report.

### 1. Cross-Reference Findings
- Match Architect's intent with Researcher's findings
- Identify where implementation diverged from design
- Find root causes for discrepancies

### 2. Prioritize Issues
Priority levels:
- P0: Critical - broken functionality, data loss risk
- P1: High - frequent failures, wrong behavior
- P2: Medium - performance, maintainability
- P3: Low - best practices, nice-to-have

### 3. Generate Recommendations
For each issue:
- Clear action to fix
- Estimated effort (low/medium/high)
- Expected impact (low/medium/high)

### 4. Create Roadmap
Group fixes into phases:
- Phase 1: Critical fixes
- Phase 2: Important improvements
- Phase 3: Optimization

### 5. Assess Overall Health
- healthy: <3 issues, no critical
- needs_attention: 3-10 issues or 1 critical
- critical: >10 issues or >1 critical

Return JSON:
{
  "summary": {
    "workflowId": "${workflowData.id}",
    "workflowName": "${workflowData.name}",
    "analysisDate": "${new Date().toISOString()}",
    "criticalIssues": 0,
    "totalIssues": 0,
    "overallHealth": "healthy|needs_attention|critical"
  },
  "findings": [
    {
      "id": "F001",
      "category": "architecture|implementation|operations|security",
      "severity": "critical|high|medium|low",
      "title": "...",
      "description": "...",
      "evidence": ["..."],
      "rootCause": "...",
      "affectedNodes": ["..."]
    }
  ],
  "recommendations": [
    {
      "id": "R001",
      "priority": "P0|P1|P2|P3",
      "title": "...",
      "description": "...",
      "effort": "low|medium|high",
      "impact": "low|medium|high",
      "relatedFindings": ["F001"]
    }
  ],
  "roadmap": [
    {
      "phase": 1,
      "title": "Critical Fixes",
      "items": ["..."],
      "dependencies": [],
      "estimatedEffort": "..."
    }
  ],
  "agentContributions": {
    "architect": "Summary of architect's analysis...",
    "researcher": "Summary of researcher's findings...",
    "analyst": "Summary of this synthesis..."
  },
  "qaExchanges": []
}`,
      }
    );

    // Parse report
    const report = this.parseAnalysisReport(result.data, workflowData, qaExchanges);

    // Store in shared context
    store.set('analystReport', report, 'analyst');

    return report;
  }

  /**
   * Parse analysis report
   */
  private parseAnalysisReport(
    data: unknown,
    workflowData: { id: string; name: string },
    qaExchanges: Array<{ from: AgentRole; to: AgentRole; question: string; answer: string; timestamp: Date }>
  ): AnalysisReport {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if ('summary' in obj && 'findings' in obj) {
        const report = obj as unknown as AnalysisReport;
        // Ensure qaExchanges is populated
        report.qaExchanges = qaExchanges;
        return report;
      }
    }

    if (typeof data === 'string') {
      const jsonMatch = data.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          const report = JSON.parse(jsonMatch[1]) as AnalysisReport;
          report.qaExchanges = qaExchanges;
          return report;
        } catch {
          // Fall through
        }
      }
    }

    // Return empty report
    return {
      summary: {
        workflowId: workflowData.id,
        workflowName: workflowData.name,
        analysisDate: new Date(),
        criticalIssues: 0,
        totalIssues: 0,
        overallHealth: 'healthy',
      },
      findings: [],
      recommendations: [],
      roadmap: [],
      agentContributions: {
        architect: '',
        researcher: '',
        analyst: '',
      },
      qaExchanges,
    };
  }

  /**
   * Handle questions from other agents
   */
  async handleQuestion(
    message: AgentMessage,
    store: SharedContextStore
  ): Promise<string> {
    const architectContext = store.get('architectContext');
    const researcherFindings = store.get('researcherFindings');

    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'complete',
      cycle: 0,
      startedAt: store.get('startedAt'),
      lastUpdatedAt: new Date(),
      history: [],
      fixAttempts: [],
      mcpCalls: [],
      agentResults: new Map(),
    };

    const result = await this.invoke(
      session,
      `Answer question from ${message.from}`,
      {
        question: message.content,
        questionContext: message.context,
        architectContext,
        researcherFindings,
        instruction: `Another agent has a question.

Question: ${message.content}

Based on all available analysis data:
1. Answer their question
2. Reference relevant findings
3. Be specific and actionable

Return your answer as plain text.`,
      }
    );

    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data);
  }

  /**
   * Generate markdown report for file output
   */
  generateMarkdownReport(report: AnalysisReport): string {
    let md = `# Workflow Analysis Report

## Summary

- **Workflow:** ${report.summary.workflowName} (${report.summary.workflowId})
- **Analysis Date:** ${new Date(report.summary.analysisDate).toISOString().split('T')[0]}
- **Overall Health:** ${this.getHealthEmoji(report.summary.overallHealth)} ${report.summary.overallHealth}
- **Total Issues:** ${report.summary.totalIssues}
- **Critical Issues:** ${report.summary.criticalIssues}

---

## Findings

`;

    if (report.findings.length === 0) {
      md += '*No issues found.*\n\n';
    } else {
      for (const finding of report.findings) {
        const severityEmoji = this.getSeverityEmoji(finding.severity);
        md += `### ${severityEmoji} ${finding.id}: ${finding.title}

**Category:** ${finding.category}
**Severity:** ${finding.severity}
${finding.affectedNodes?.length ? `**Affected Nodes:** ${finding.affectedNodes.join(', ')}` : ''}

${finding.description}

${finding.rootCause ? `**Root Cause:** ${finding.rootCause}` : ''}

**Evidence:**
${finding.evidence.map(e => `- ${e}`).join('\n')}

---

`;
      }
    }

    md += `## Recommendations

`;

    if (report.recommendations.length === 0) {
      md += '*No recommendations.*\n\n';
    } else {
      for (const rec of report.recommendations) {
        md += `### ${rec.priority} ${rec.id}: ${rec.title}

${rec.description}

- **Effort:** ${rec.effort}
- **Impact:** ${rec.impact}
- **Related Findings:** ${rec.relatedFindings.join(', ')}

`;
      }
    }

    md += `## Implementation Roadmap

`;

    for (const phase of report.roadmap) {
      md += `### Phase ${phase.phase}: ${phase.title}

${phase.items.map(item => `- ${item}`).join('\n')}

${phase.dependencies.length ? `**Dependencies:** ${phase.dependencies.join(', ')}` : ''}
**Estimated Effort:** ${phase.estimatedEffort}

`;
    }

    if (report.qaExchanges.length > 0) {
      md += `## Q&A Between Agents

`;
      for (const qa of report.qaExchanges) {
        md += `**${qa.from} → ${qa.to}:** ${qa.question}
> ${qa.answer}

`;
      }
    }

    md += `---

*Generated by Context-First Analyzer*
`;

    return md;
  }

  private getHealthEmoji(health: string): string {
    switch (health) {
      case 'healthy': return '✅';
      case 'needs_attention': return '⚠️';
      case 'critical': return '🔴';
      default: return '❓';
    }
  }

  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }
}

export const analystAgent = new AnalystAgent();
