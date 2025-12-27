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
} from '../types.js';

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
  constructor() {
    super('architect', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      skills: ['n8n-workflow-patterns', 'n8n-mcp-tools-expert'],
      mcpTools: [], // Architect has NO MCP tools
      promptFile: 'architect.md',
      indexFile: 'architect_patterns.md',
    });
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
}

export const architectAgent = new ArchitectAgent();
