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
} from '../types.js';

// Paths relative to sdk-migration directory
const LEARNINGS_PATH = path.resolve(process.cwd(), 'docs', 'learning', 'LEARNINGS.md');
const CONTEXT_PATH = path.resolve(process.cwd(), 'docs', 'SYSTEM-CONTEXT.md');

export class AnalystAgent extends BaseAgent {
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
}

export const analystAgent = new AnalystAgent();
