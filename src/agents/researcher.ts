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
  AgentMode,
  ResearcherAnalysisFindings,
  AgentMessage,
  NodeAudit,
  ConnectionIssue,
} from '../types.js';
import type { SharedContextStore } from '../shared/context-store.js';
import type { MessageCoordinator } from '../shared/message-protocol.js';

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
   * Set operating mode - changes behavior and prompts
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;

    if (mode === 'analyze') {
      this.config.promptFile = 'researcher-analyze.md';
      // In analyze mode, add validation tool
      this.config.mcpTools = [
        'mcp__n8n-mcp__search_nodes',
        'mcp__n8n-mcp__get_node',
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_executions',
        'mcp__n8n-mcp__n8n_validate_workflow',
        'mcp__n8n-mcp__validate_node',
      ];
    } else {
      this.config.promptFile = 'researcher.md';
      this.config.mcpTools = [
        'mcp__n8n-mcp__search_nodes',
        'mcp__n8n-mcp__get_node',
        'mcp__n8n-mcp__get_template',
        'mcp__n8n-mcp__search_templates',
        'mcp__n8n-mcp__n8n_list_workflows',
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_executions',
      ];
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

  // ============================================
  // ANALYZE MODE METHODS
  // ============================================

  /**
   * Audit workflow in ANALYZE mode
   */
  async auditWorkflow(
    store: SharedContextStore,
    coordinator: MessageCoordinator
  ): Promise<ResearcherAnalysisFindings> {
    if (this.mode !== 'analyze') {
      throw new Error('auditWorkflow only available in ANALYZE mode');
    }

    const workflowData = store.get('workflowData');
    const nodeSchemas = store.get('nodeSchemas');
    const executionHistory = store.get('executionHistory');
    const architectContext = store.get('architectContext');

    // Create minimal session
    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'research',
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
      'Conduct technical audit of workflow',
      {
        workflow: {
          id: workflowData.id,
          name: workflowData.name,
          nodes: workflowData.nodes,
          connections: workflowData.connections,
        },
        nodeSchemas,
        executionHistory: {
          total: executionHistory.total,
          successRate: executionHistory.successRate,
          errorPatterns: executionHistory.errorPatterns,
        },
        architectContext: architectContext ? {
          purpose: architectContext.businessContext.purpose,
          expectedFlow: architectContext.dataFlow.diagram,
          gaps: architectContext.gapAnalysis.gaps,
        } : null,
        instruction: `## TECHNICAL AUDIT TASK

Conduct a comprehensive technical audit of this workflow.

### 1. Node-by-Node Audit
For each node, check:
- Is typeVersion current or outdated?
- Are required parameters configured?
- Are there deprecated patterns?
- Are credentials properly referenced?

Use get_node to get schema for each node type.
Use validate_node to check configurations.

### 2. Connection Analysis
- Are all nodes connected? (find orphans)
- Are there dead-end nodes? (output not used)
- Is Switch/If routing correct?

### 3. Execution Pattern Analysis
- What is the success rate?
- Which nodes fail most often?
- What are common error types?

### 4. Gap Analysis
Compare with Architect's expected flow.
- Does the implementation match intent?
- What's missing or wrong?

### 5. Questions for Architect
If you find something unclear about INTENT:
- Note it in questionsForArchitect

Return JSON:
{
  "nodeAudits": [
    {
      "nodeName": "...",
      "nodeType": "...",
      "typeVersion": 1,
      "latestVersion": 2,
      "issues": [
        {
          "type": "version|config|credential|connection|expression|logic",
          "severity": "critical|high|medium|low",
          "message": "...",
          "suggestion": "...",
          "evidence": "..."
        }
      ],
      "deprecationStatus": "current|outdated|deprecated"
    }
  ],
  "connectionIssues": [
    {
      "type": "orphan|dead_end|routing|type_mismatch",
      "nodeName": "...",
      "message": "...",
      "severity": "critical|high|medium|low"
    }
  ],
  "executionPatterns": {
    "successRate": 0.85,
    "avgExecutionTime": 4500,
    "problematicNodes": ["Node1", "Node2"],
    "commonErrors": ["error1", "error2"],
    "recommendations": ["rec1", "rec2"]
  },
  "questionsAsked": 0,
  "totalIssues": 5
}`,
      }
    );

    // Parse findings
    const findings = this.parseAnalysisFindings(result.data);

    // Store in shared context
    store.set('researcherFindings', findings, 'researcher');

    return findings;
  }

  /**
   * Parse analysis findings
   */
  private parseAnalysisFindings(data: unknown): ResearcherAnalysisFindings {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if ('nodeAudits' in obj) {
        return obj as unknown as ResearcherAnalysisFindings;
      }
    }

    if (typeof data === 'string') {
      const jsonMatch = data.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]) as ResearcherAnalysisFindings;
        } catch {
          // Fall through
        }
      }
    }

    return {
      nodeAudits: [],
      connectionIssues: [],
      executionPatterns: {
        successRate: 0,
        problematicNodes: [],
        commonErrors: [],
        recommendations: [],
      },
      questionsAsked: 0,
      totalIssues: 0,
    };
  }

  /**
   * Handle questions from other agents
   */
  async handleQuestion(
    message: AgentMessage,
    store: SharedContextStore
  ): Promise<string> {
    const workflowData = store.get('workflowData');
    const findings = store.get('researcherFindings');

    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'research',
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
        myFindings: findings,
        workflowSummary: {
          nodeCount: workflowData.nodes.length,
          nodes: workflowData.nodes.map(n => ({ name: n.name, type: n.type })),
        },
        instruction: `Another agent has a question about the workflow.

Question: ${message.content}

Context: ${JSON.stringify(message.context)}

Based on your technical audit:
1. Answer their specific question with technical details
2. Reference specific nodes if relevant
3. If unsure, say so and suggest what to check

Return your answer as plain text.`,
      }
    );

    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data);
  }
}

export const researcherAgent = new ResearcherAgent();
