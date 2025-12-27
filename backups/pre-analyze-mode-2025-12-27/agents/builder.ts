/**
 * Builder Agent
 * ONLY agent that mutates workflows
 *
 * Responsibilities:
 * - Create/Update/Delete workflows
 * - Autofix validation errors
 * - Apply surgical edits (edit_scope only)
 *
 * Protocols:
 * - L-075: Anti-hallucination (MCP calls required)
 * - L-079: Post-build verification
 * - Surgical edits (partial update only)
 * - Snapshot before destructive changes
 * - Wipe protection (>50% nodes = STOP)
 * - edit_scope enforcement
 * - mcp_calls logging (GATE 5)
 *
 * Model: Opus 4.5 (most capable)
 */

import { BaseAgent } from './base-agent.js';
import type {
  SessionContext,
  MCPCall,
  BuildResult,
  PostBuildVerification,
  BlueprintResult,
} from '../types.js';
import { sessionManager } from '../orchestrator/session-manager.js';

export class BuilderAgent extends BaseAgent {
  constructor() {
    super('builder', {
      model: 'claude-opus-4-5-20251101', // OPUS for Builder
      maxTokens: 16384,
      skills: [
        'n8n-node-configuration',
        'n8n-expression-syntax',
        'n8n-code-javascript',
        'n8n-code-python',
      ],
      mcpTools: [
        'mcp__n8n-mcp__n8n_create_workflow',
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_update_full_workflow',
        'mcp__n8n-mcp__n8n_update_partial_workflow',
        'mcp__n8n-mcp__n8n_delete_workflow',
        'mcp__n8n-mcp__n8n_validate_workflow',
        'mcp__n8n-mcp__n8n_autofix_workflow',
        'mcp__n8n-mcp__validate_node',
        'mcp__n8n-mcp__get_node',
        'mcp__n8n-mcp__search_nodes',
      ],
      promptFile: 'builder.md',
      indexFile: 'builder_gotchas.md',
      protocols: ['L-075', 'L-079', 'surgical-edits', 'wipe-protection'],
    });
  }

  /**
   * Process result from Agent SDK with GATE 5 enforcement
   */
  protected async processResult(
    result: string,
    session: SessionContext,
    mcpCalls: MCPCall[]
  ): Promise<BuildResult> {
    // Extract workflow ID from MCP calls
    let workflowId: string | undefined;
    for (const call of mcpCalls) {
      if (call.params?.id) {
        workflowId = call.params.id as string;
        break;
      }
    }

    return this.parseBuildResult(result, mcpCalls, workflowId);
  }

  /**
   * Parse build result from response
   */
  private parseBuildResult(
    content: string,
    mcpCalls: MCPCall[],
    workflowId?: string
  ): BuildResult {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          ...parsed,
          mcp_calls: mcpCalls,
        } as BuildResult;
      } catch {
        // Fall through
      }
    }

    return {
      workflow_id: workflowId || '',
      workflow_name: '',
      node_count: 0,
      version_id: 0,
      graph_hash: '',
      mcp_calls: mcpCalls,
      snapshot_taken: false,
      verification: {
        version_changed: false,
        expected_changes_applied: false,
        nodes_match: false,
        connections_valid: false,
      },
    };
  }

  /**
   * Build workflow from blueprint
   */
  async build(
    session: SessionContext,
    blueprint: BlueprintResult
  ): Promise<BuildResult> {
    // Inject ALREADY_TRIED for GATE 4
    const alreadyTried = await sessionManager.formatAlreadyTried(session.id);

    const result = await this.invoke(
      session,
      'Build workflow from blueprint',
      {
        blueprint,
        alreadyTried: alreadyTried || undefined,
        protocols: ['L-075', 'L-079'],
        instruction: `Build workflow following these MANDATORY protocols:

## L-075: Anti-Hallucination
- MUST make real MCP calls
- NEVER invent workflow IDs
- Verify with n8n_get_workflow after create

## L-079: Post-Build Verification
- After mutation, re-fetch workflow
- Verify version_id changed
- Compare expected vs actual

## Wipe Protection
- If removing >50% nodes: STOP, report to user

Return JSON:
{
  "workflow_id": "...",
  "workflow_name": "...",
  "node_count": N,
  "version_id": N,
  "graph_hash": "...",
  "snapshot_taken": true/false,
  "verification": {
    "version_changed": true,
    "expected_changes_applied": true,
    "nodes_match": true,
    "connections_valid": true
  }
}`,
      }
    );

    return result.data as BuildResult;
  }

  /**
   * Fix workflow with surgical edits
   */
  async fix(
    session: SessionContext,
    workflowId: string,
    editScope: string[],
    errorDetails: string
  ): Promise<BuildResult> {
    // Inject ALREADY_TRIED for GATE 4
    const alreadyTried = await sessionManager.formatAlreadyTried(session.id);

    const result = await this.invoke(
      session,
      `Fix workflow ${workflowId}`,
      {
        workflowId,
        editScope,
        errorDetails,
        alreadyTried: alreadyTried || undefined,
        instruction: `Fix using SURGICAL EDITS only:

## edit_scope (ONLY touch these nodes):
${editScope.map(n => `- ${n}`).join('\n')}

## Error to fix:
${errorDetails}

${alreadyTried ? `## ALREADY TRIED (DO NOT REPEAT!):\n${alreadyTried}` : ''}

## Rules:
1. Use n8n_update_partial_workflow ONLY
2. Only modify nodes in edit_scope
3. Take snapshot before destructive changes
4. Verify with n8n_get_workflow after

Return JSON with verification.`,
      }
    );

    // Log fix attempt for GATE 4
    await sessionManager.logFixAttempt(session.id, {
      cycle: session.cycle,
      approach: errorDetails,
      result: (result.data as BuildResult).verification.expected_changes_applied ? 'success' : 'failed',
      nodesAffected: editScope,
    });

    return result.data as BuildResult;
  }

  /**
   * Apply autofix suggestions
   */
  async autofix(
    session: SessionContext,
    workflowId: string
  ): Promise<BuildResult> {
    const result = await this.invoke(
      session,
      `Autofix workflow ${workflowId}`,
      {
        workflowId,
        instruction: `Apply autofix:
1. Call n8n_autofix_workflow
2. Review applied fixes
3. Verify with n8n_get_workflow
4. Return verification result`,
      }
    );

    return result.data as BuildResult;
  }

  /**
   * Delete workflow (with confirmation)
   */
  async delete(
    session: SessionContext,
    workflowId: string,
    confirmed: boolean
  ): Promise<{ deleted: boolean; workflowId: string }> {
    if (!confirmed) {
      return { deleted: false, workflowId };
    }

    const result = await this.invoke(
      session,
      `Delete workflow ${workflowId}`,
      {
        workflowId,
        instruction: `Delete workflow:
1. Take snapshot first (safety)
2. Call n8n_delete_workflow
3. Verify deletion

Return JSON:
{
  "deleted": true/false,
  "workflowId": "..."
}`,
      }
    );

    return result.data as { deleted: boolean; workflowId: string };
  }

  /**
   * Verify post-build (L-079)
   */
  async verifyBuild(
    session: SessionContext,
    workflowId: string,
    expectedChanges: {
      nodeCount: number;
      modifiedNodes: string[];
    }
  ): Promise<PostBuildVerification> {
    const result = await this.invoke(
      session,
      `Verify build for ${workflowId}`,
      {
        workflowId,
        expectedChanges,
        instruction: `L-079 Post-Build Verification:
1. Fetch workflow: n8n_get_workflow
2. Check version_id changed
3. Verify node count matches
4. Confirm modified nodes exist

Return JSON:
{
  "version_changed": true/false,
  "expected_changes_applied": true/false,
  "nodes_match": true/false,
  "connections_valid": true/false
}`,
      }
    );

    return result.data as PostBuildVerification;
  }
}

export const builderAgent = new BuilderAgent();
