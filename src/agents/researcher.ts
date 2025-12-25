/**
 * Researcher Agent
 * Search + Execution Analysis
 *
 * Responsibilities:
 * - L-066: 5-Tier Search Hierarchy
 * - L-067: Two-step execution analysis
 * - Hypothesis validation (GATE 6)
 * - Alternative approach search (cycle 4-5)
 * - Deep dive analysis (cycle 6-7)
 * - Credential discovery
 *
 * Key Features:
 * - Full MCP read/search access
 * - Skills: mcp-tools-expert, node-configuration
 */

import { BaseAgent } from './base-agent.js';
import type {
  SessionContext,
  MCPCall,
  ResearchFindings,
  TemplateInfo,
  NodeInfo,
  WorkflowInfo,
  CredentialInfo,
} from '../types.js';

export class ResearcherAgent extends BaseAgent {
  constructor() {
    super('researcher', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      skills: ['n8n-mcp-tools-expert', 'n8n-node-configuration'],
      mcpTools: [
        'mcp__n8n-mcp__search_nodes',
        'mcp__n8n-mcp__get_node',
        'mcp__n8n-mcp__get_template',
        'mcp__n8n-mcp__search_templates',
        'mcp__n8n-mcp__n8n_list_workflows',
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_executions',
      ],
      promptFile: 'researcher.md',
      indexFile: 'researcher_nodes.md',
    });
  }

  /**
   * Process result from Agent SDK
   */
  protected async processResult(
    result: string,
    session: SessionContext,
    mcpCalls: MCPCall[]
  ): Promise<ResearchFindings> {
    return this.parseFindings(result);
  }

  /**
   * Parse research findings from response
   */
  private parseFindings(content: string): ResearchFindings {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as ResearchFindings;
      } catch {
        // Fall through
      }
    }

    return {
      hypothesis: '',
      hypothesis_validated: false,
      fit_score: 0,
      templates_found: [],
      nodes_found: [],
      existing_workflows: [],
    };
  }

  /**
   * L-066: 5-Tier Search Hierarchy
   * 1. Local LEARNINGS
   * 2. Existing n8n workflows
   * 3. n8n templates
   * 4. Node documentation
   * 5. Web search
   */
  async search(
    session: SessionContext,
    query: string
  ): Promise<ResearchFindings> {
    const result = await this.invoke(session, query, {
      protocol: 'L-066',
      instruction: `Execute 5-Tier Search Hierarchy:
1. Check LEARNINGS-INDEX.md first
2. Search existing workflows: n8n_list_workflows
3. Search templates: search_templates
4. Search nodes: search_nodes
5. Get node details: get_node

Return JSON:
{
  "hypothesis": "What I think will work",
  "hypothesis_validated": true/false,
  "fit_score": 0.0-1.0,
  "templates_found": [{"id": 123, "name": "...", "fit_score": 0.9, "nodes": [...]}],
  "nodes_found": [{"type": "...", "name": "...", "version": 2}],
  "existing_workflows": [{"id": "...", "name": "...", "active": true}]
}`,
    });

    return result.data as ResearchFindings;
  }

  /**
   * L-067: Two-step execution analysis
   * Step 1: mode="summary" to find WHERE
   * Step 2: mode="filtered" to find WHY
   */
  async analyzeExecution(
    session: SessionContext,
    workflowId: string,
    executionId?: string
  ): Promise<{
    where: string;
    why: string;
    failedNode: string;
    errorType: string;
    hypothesis: string;
  }> {
    const result = await this.invoke(
      session,
      `Analyze execution failure for workflow ${workflowId}`,
      {
        protocol: 'L-067',
        workflowId,
        executionId,
        instruction: `Execute L-067 Two-Step Analysis:

STEP 1: Find WHERE (mode="summary")
- Call n8n_executions with mode="summary"
- Identify which node failed

STEP 2: Find WHY (mode="filtered")
- Call n8n_executions with mode="filtered", nodeNames=[failed_node]
- Analyze error details

NEVER use mode="full" for workflows with >10 nodes!

Return JSON:
{
  "where": "Node name where failure occurred",
  "why": "Root cause explanation",
  "failedNode": "exact_node_name",
  "errorType": "validation|runtime|connection|expression",
  "hypothesis": "I believe the fix is..."
}`,
      }
    );

    return result.data as {
      where: string;
      why: string;
      failedNode: string;
      errorType: string;
      hypothesis: string;
    };
  }

  /**
   * Alternative approach search (cycle 4-5)
   */
  async findAlternative(
    session: SessionContext,
    failedApproaches: string[]
  ): Promise<ResearchFindings> {
    const result = await this.invoke(
      session,
      'Find alternative approach after failures',
      {
        failedApproaches,
        instruction: `Previous approaches failed. Find alternative:
1. Search for different node types
2. Look for templates solving similar problems
3. Check LEARNINGS for known workarounds

Return findings with NEW approach, not repeating failed ones.`,
      }
    );

    return result.data as ResearchFindings;
  }

  /**
   * Deep dive analysis (cycle 6-7)
   */
  async deepDive(
    session: SessionContext,
    workflowId: string,
    errorHistory: string[]
  ): Promise<{
    rootCause: string;
    systemicIssue: boolean;
    recommendations: string[];
    alternativeNodes: NodeInfo[];
  }> {
    const result = await this.invoke(
      session,
      'Deep dive root cause analysis',
      {
        workflowId,
        errorHistory,
        instruction: `This is cycle 6-7 - deep investigation needed.
1. Analyze full error history
2. Check for systemic issues
3. Consider architectural changes
4. Research alternative implementations

Return JSON:
{
  "rootCause": "The fundamental issue is...",
  "systemicIssue": true/false,
  "recommendations": ["rec1", "rec2"],
  "alternativeNodes": [{"type": "...", "name": "..."}]
}`,
      }
    );

    return result.data as {
      rootCause: string;
      systemicIssue: boolean;
      recommendations: string[];
      alternativeNodes: NodeInfo[];
    };
  }

  /**
   * Discover available credentials
   */
  async discoverCredentials(
    session: SessionContext,
    neededTypes: string[]
  ): Promise<CredentialInfo[]> {
    const result = await this.invoke(
      session,
      'Discover available credentials',
      {
        neededTypes,
        instruction: `Search for credentials matching needed types.
Use appropriate MCP calls to find credentials.

Return JSON array:
[{"id": "123", "name": "My API Key", "type": "openaiApi"}]`,
      }
    );

    const data = result.data as { credentials_discovered?: CredentialInfo[] };
    return data.credentials_discovered || [];
  }

  /**
   * Validate hypothesis (GATE 6)
   */
  async validateHypothesis(
    session: SessionContext,
    hypothesis: string
  ): Promise<{ validated: boolean; confidence: number; evidence: string[] }> {
    const result = await this.invoke(
      session,
      `Validate hypothesis: ${hypothesis}`,
      {
        instruction: `Validate the hypothesis:
1. Check if nodes exist
2. Verify configuration is possible
3. Look for similar successful implementations

Return JSON:
{
  "validated": true/false,
  "confidence": 0.0-1.0,
  "evidence": ["evidence1", "evidence2"]
}`,
      }
    );

    return result.data as {
      validated: boolean;
      confidence: number;
      evidence: string[];
    };
  }
}

export const researcherAgent = new ResearcherAgent();
