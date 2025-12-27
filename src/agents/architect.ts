/**
 * Architect Agent
 * 5-phase dialog + planning
 *
 * Responsibilities:
 * - Clarification dialog with user
 * - Present options to user
 * - Create blueprint
 * - Credential selection dialog
 *
 * Key Features:
 * - NO MCP tools (uses Researcher for data)
 * - WebSearch for external research
 * - Skills: workflow-patterns, mcp-tools-expert
 */

import { BaseAgent } from './base-agent.js';
import type {
  SessionContext,
  MCPCall,
  ResearchFindings,
  CredentialInfo,
  AgentMode,
  ArchitectAnalysis,
  AgentMessage,
} from '../types.js';
import type { SharedContextStore } from '../shared/context-store.js';

export interface ArchitectOutput {
  type: 'clarification' | 'options' | 'blueprint' | 'credentials';
  content: unknown;
}

export interface ClarificationResult {
  requirements: string;
  complexity: 'simple' | 'medium' | 'complex';
  needsResearch: boolean;
  researchQuery?: string;
  isConversational: boolean;  // True if request is greeting/help/question (not workflow building)
  response?: string;          // Direct response for conversational requests
  nodeCount?: number;         // Explicit node count if user specified (e.g., "10 nodes")
  explicitRequirements?: string[];  // List of explicit user requirements to preserve
}

export interface OptionsResult {
  options: Array<{
    id: string;
    name: string;
    description: string;
    pros: string[];
    cons: string[];
    fit_score: number;
  }>;
  recommendation: string;
}

export interface BlueprintResult {
  workflow_name: string;
  description: string;
  nodes: Array<{
    name: string;
    type: string;
    purpose: string;
  }>;
  connections: Array<{
    from: string;
    to: string;
  }>;
  credentials_needed: string[];
}

export interface CredentialsResult {
  selected: CredentialInfo[];
  missing: string[];
}

export class ArchitectAgent extends BaseAgent {
  private mode: AgentMode = 'create';

  constructor() {
    super('architect', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      skills: ['n8n-workflow-patterns', 'n8n-mcp-tools-expert'],
      mcpTools: [], // Architect has NO MCP tools in create mode
      promptFile: 'architect.md',
      indexFile: 'architect_patterns.md',
    });
  }

  /**
   * Set operating mode - changes behavior and prompts
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;

    if (mode === 'analyze') {
      this.config.promptFile = 'architect-analyze.md';
      // In analyze mode, architect gets read-only MCP access
      this.config.mcpTools = [
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_list_workflows',
      ];
    } else {
      this.config.promptFile = 'architect.md';
      this.config.mcpTools = [];
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
  ): Promise<ArchitectOutput> {
    // Parse structured output from result
    return this.parseArchitectOutput(result, session);
  }

  /**
   * Parse architect output based on JSON content structure
   */
  private parseArchitectOutput(
    content: string,
    session: SessionContext
  ): ArchitectOutput {
    // Try to detect type from JSON content
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);

        // Detect by fields present
        if ('workflow_name' in parsed && 'nodes' in parsed) {
          return { type: 'blueprint', content: parsed as BlueprintResult };
        }
        if ('options' in parsed && 'recommendation' in parsed) {
          return { type: 'options', content: parsed as OptionsResult };
        }
        if ('selected' in parsed && 'missing' in parsed) {
          return { type: 'credentials', content: parsed as CredentialsResult };
        }
        if ('requirements' in parsed && 'complexity' in parsed) {
          return { type: 'clarification', content: parsed as ClarificationResult };
        }
      } catch {
        // Fall through to stage-based detection
      }
    }

    // Fallback to stage-based parsing
    switch (session.stage) {
      case 'clarification':
        return { type: 'clarification', content: this.parseClarification(content) };
      case 'credentials':
        return { type: 'credentials', content: this.parseCredentials(content) };
      default:
        // Try blueprint first, then options
        const blueprint = this.parseBlueprint(content);
        if (blueprint.workflow_name && blueprint.nodes.length > 0) {
          return { type: 'blueprint', content: blueprint };
        }
        return { type: 'options', content: this.parseOptions(content) };
    }
  }

  /**
   * Parse clarification response
   */
  private parseClarification(content: string): ClarificationResult {
    // Extract JSON block from response
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as ClarificationResult;
      } catch {
        // Fall through to text parsing
      }
    }

    // Try to extract nodeCount from text (e.g., "10 nodes", "5 step")
    const nodeCountMatch = content.match(/(\d+)\s*(node|нод|step|шаг)/i);
    const nodeCount = nodeCountMatch ? parseInt(nodeCountMatch[1]) : undefined;

    // Parse from text
    return {
      requirements: content,
      complexity: this.detectComplexity(content),
      needsResearch: content.toLowerCase().includes('research') ||
                     content.toLowerCase().includes('search'),
      isConversational: false,
      response: undefined,
      nodeCount,
      explicitRequirements: nodeCount ? [`${nodeCount} nodes`] : undefined,
    };
  }

  /**
   * Parse options response
   */
  private parseOptions(content: string): OptionsResult {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as OptionsResult;
      } catch {
        // Fall through
      }
    }

    return {
      options: [],
      recommendation: content,
    };
  }

  /**
   * Parse blueprint response
   */
  private parseBlueprint(content: string): BlueprintResult {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as BlueprintResult;
      } catch {
        // Fall through
      }
    }

    return {
      workflow_name: 'Untitled Workflow',
      description: content,
      nodes: [],
      connections: [],
      credentials_needed: [],
    };
  }

  /**
   * Parse credentials response
   */
  private parseCredentials(content: string): CredentialsResult {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as CredentialsResult;
      } catch {
        // Fall through
      }
    }

    return {
      selected: [],
      missing: [],
    };
  }

  /**
   * Detect complexity from requirements
   */
  private detectComplexity(content: string): 'simple' | 'medium' | 'complex' {
    const complexKeywords = ['multiple', 'integration', 'api', 'database', 'complex'];
    const simpleKeywords = ['simple', 'basic', 'just', 'only'];

    const lowerContent = content.toLowerCase();

    if (complexKeywords.some(k => lowerContent.includes(k))) {
      return 'complex';
    }
    if (simpleKeywords.some(k => lowerContent.includes(k))) {
      return 'simple';
    }
    return 'medium';
  }

  /**
   * Clarify requirements with user
   */
  async clarify(
    session: SessionContext,
    userRequest: string
  ): Promise<ClarificationResult> {
    const result = await this.invoke(session, userRequest, {
      phase: 'clarification',
      instruction: `Analyze user request and clarify requirements.

IMPORTANT: Extract explicit numeric requirements!
- If user says "10 nodes" → nodeCount: 10
- If user says "5 step workflow" → nodeCount: 5
- If user specifies ANY numbers → preserve them in explicitRequirements

Return JSON:
{
  "requirements": "detailed requirements",
  "complexity": "simple|medium|complex",
  "needsResearch": true/false,
  "researchQuery": "what to search for",
  "nodeCount": 10,  // REQUIRED if user specified node count
  "explicitRequirements": ["10 nodes", "must have error handling"]  // List of explicit user requirements
}`,
    });

    return (result.data as ArchitectOutput).content as ClarificationResult;
  }

  /**
   * Present options to user based on research
   */
  async presentOptions(
    session: SessionContext,
    findings: ResearchFindings
  ): Promise<OptionsResult> {
    const result = await this.invoke(
      session,
      'Present options to user based on research findings',
      {
        phase: 'decision',
        findings,
        instruction: `Based on research, present 2-3 options.
Return JSON:
{
  "options": [
    {
      "id": "A",
      "name": "Option name",
      "description": "What it does",
      "pros": ["pro1", "pro2"],
      "cons": ["con1"],
      "fit_score": 0.85
    }
  ],
  "recommendation": "Recommend option X because..."
}`,
      }
    );

    return (result.data as ArchitectOutput).content as OptionsResult;
  }

  /**
   * Create blueprint based on decision
   * L-110: Now includes explicit requirements enforcement
   */
  async createBlueprint(
    session: SessionContext,
    decision: string,
    findings: ResearchFindings
  ): Promise<BlueprintResult> {
    // Build requirements enforcement string
    let requirementsEnforcement = '';
    if (session.requirements?.nodeCount) {
      requirementsEnforcement = `
CRITICAL REQUIREMENT: User explicitly requested ${session.requirements.nodeCount} nodes.
You MUST create a blueprint with AT LEAST ${session.requirements.nodeCount} nodes.
If needed, add helper nodes like Set, Code, If, Switch to reach the minimum.`;
    }
    if (session.requirements?.explicitRequirements?.length) {
      requirementsEnforcement += `
Explicit requirements to preserve:
${session.requirements.explicitRequirements.map(r => `- ${r}`).join('\n')}`;
    }

    const result = await this.invoke(
      session,
      'Create workflow blueprint',
      {
        phase: 'blueprint',
        decision,
        findings,
        instruction: `Create detailed blueprint for Builder.
${requirementsEnforcement}

Return JSON:
{
  "workflow_name": "My Workflow",
  "description": "What it does",
  "nodes": [{"name": "Node1", "type": "n8n-nodes-base.webhook", "purpose": "..."}],
  "connections": [{"from": "Node1", "to": "Node2"}],
  "credentials_needed": ["telegram", "openai"]
}`,
      }
    );

    return (result.data as ArchitectOutput).content as BlueprintResult;
  }

  /**
   * Handle credential selection
   */
  async selectCredentials(
    session: SessionContext,
    available: CredentialInfo[],
    needed: string[]
  ): Promise<CredentialsResult> {
    const result = await this.invoke(
      session,
      'Help user select credentials',
      {
        phase: 'credentials',
        available,
        needed,
        instruction: `Match available credentials to needed types.
Return JSON:
{
  "selected": [{"id": "123", "name": "My Telegram", "type": "telegram"}],
  "missing": ["openai"]
}`,
      }
    );

    return (result.data as ArchitectOutput).content as CredentialsResult;
  }

  // ============================================
  // ANALYZE MODE METHODS
  // ============================================

  /**
   * Analyze project context from documentation
   * Only available in ANALYZE mode
   */
  async analyzeProjectContext(
    store: SharedContextStore
  ): Promise<ArchitectAnalysis> {
    if (this.mode !== 'analyze') {
      throw new Error('analyzeProjectContext only available in ANALYZE mode');
    }

    const projectDocs = store.get('projectDocs');
    const workflowData = store.get('workflowData');

    // Create a minimal session for invoke
    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'clarification',
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
      'Analyze project context and workflow architecture',
      {
        projectDocs,
        workflowSummary: {
          name: workflowData.name,
          nodeCount: workflowData.nodes.length,
          nodeTypes: [...new Set(workflowData.nodes.map(n => n.type))],
        },
        instruction: `## STRATEGIC ANALYSIS TASK

You have access to project documentation and workflow structure.
Your goal: Understand the INTENT behind this system.

### STEP 1: Business Context
- What is this system's purpose?
- Who are the users?
- What problems does it solve?

### STEP 2: Service Architecture
- What external services are used? (Telegram, OpenAI, Supabase, etc.)
- Why each service was chosen?
- How do they interact?

### STEP 3: Data Flow
- How does data enter the system?
- How is it processed?
- How does it exit?

### STEP 4: Design Decisions
- What architectural choices were made?
- What were the trade-offs?
- What was prioritized?

### STEP 5: Original Intent vs Current State
- What was planned (from TODO, PLAN)?
- What is implemented (from workflow)?
- What gaps exist?

Return JSON:
{
  "businessContext": {
    "purpose": "...",
    "users": ["..."],
    "useCases": ["..."],
    "successMetrics": ["..."]
  },
  "serviceArchitecture": {
    "services": [
      {"name": "Telegram", "role": "...", "whyChosen": "..."}
    ],
    "integrationPattern": "..."
  },
  "dataFlow": {
    "entry": ["..."],
    "processing": ["..."],
    "exit": ["..."],
    "diagram": "User → Telegram → ..."
  },
  "designDecisions": [
    {"decision": "...", "rationale": "...", "tradeoff": "..."}
  ],
  "gapAnalysis": {
    "planned": ["..."],
    "implemented": ["..."],
    "gaps": ["..."]
  }
}`,
      }
    );

    // Parse result
    const analysis = this.parseAnalysis(result.data);

    // Store in shared context
    store.set('architectContext', analysis, 'architect');

    return analysis;
  }

  /**
   * Parse analysis result
   */
  private parseAnalysis(data: unknown): ArchitectAnalysis {
    // If data is already structured
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if ('businessContext' in obj) {
        return obj as unknown as ArchitectAnalysis;
      }
    }

    // Try to parse from string
    if (typeof data === 'string') {
      const jsonMatch = data.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]) as ArchitectAnalysis;
        } catch {
          // Fall through
        }
      }
    }

    // Return empty analysis
    return {
      businessContext: {
        purpose: 'Unknown',
        users: [],
        useCases: [],
        successMetrics: [],
      },
      serviceArchitecture: {
        services: [],
        integrationPattern: 'Unknown',
      },
      dataFlow: {
        entry: [],
        processing: [],
        exit: [],
        diagram: '',
      },
      designDecisions: [],
      gapAnalysis: {
        planned: [],
        implemented: [],
        gaps: [],
      },
    };
  }

  /**
   * Handle questions from other agents
   */
  async handleQuestion(
    message: AgentMessage,
    store: SharedContextStore
  ): Promise<string> {
    const context = store.get('architectContext');
    const projectDocs = store.get('projectDocs');

    // Create minimal session
    const session: SessionContext = {
      id: store.get('analysisId'),
      stage: 'clarification',
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
        myAnalysis: context,
        projectDocs,
        instruction: `Another agent has a question for you.

Question: ${message.content}

Context they provided: ${JSON.stringify(message.context)}

Based on your understanding of the project:
1. Answer their specific question
2. Cite evidence from documentation if available
3. If you're not sure, say so clearly

Return your answer as plain text (not JSON).`,
      }
    );

    return typeof result.data === 'string'
      ? result.data
      : JSON.stringify(result.data);
  }
}

export const architectAgent = new ArchitectAgent();
