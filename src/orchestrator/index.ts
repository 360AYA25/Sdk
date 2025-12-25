/**
 * Orchestrator
 * Main routing logic for 5-Agent system
 *
 * Responsibilities:
 * - Route between agents based on stage
 * - Enforce validation gates (GATE 1-6)
 * - Manage QA loop (max 7 cycles, progressive escalation)
 * - Handle stage transitions
 * - Coordinate handoffs between agents
 *
 * Key Rule: Orchestrator = PURE ROUTER
 * - NO direct MCP calls
 * - ONLY delegates via agents
 */

import type {
  SessionContext,
  Stage,
  AgentRole,
  ResearchFindings,
  BuildResult,
  QAReport,
  AnalystReport,
  BlueprintResult,
  HandoffContext,
  EscalationLevel,
} from '../types.js';
import { sessionManager } from './session-manager.js';
import { gateEnforcer } from './gate-enforcer.js';
import { architectAgent, ClarificationResult, OptionsResult } from '../agents/architect.js';
import { researcherAgent } from '../agents/researcher.js';
import { builderAgent } from '../agents/builder.js';
import { qaAgent } from '../agents/qa.js';
import { analystAgent } from '../agents/analyst.js';
import { ui } from './user-interface.js';

export class Orchestrator {
  private session: SessionContext | null = null;

  /**
   * Initialize orchestrator with new session
   */
  async start(userRequest: string, workflowId?: string): Promise<string> {
    // Create session
    this.session = await sessionManager.createSession(workflowId);

    console.log(`[Orchestrator] Session created: ${this.session.id}`);
    console.log(`[Orchestrator] User request: ${userRequest}`);

    // Add user request to history
    await sessionManager.addHistory(this.session.id, {
      role: 'user',
      content: userRequest,
    });

    // Start the flow
    return this.runFlow(userRequest);
  }

  /**
   * Resume existing session
   */
  async resume(sessionId: string): Promise<string> {
    this.session = await sessionManager.loadSession(sessionId);

    if (!this.session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    console.log(`[Orchestrator] Resumed session: ${sessionId}`);
    console.log(`[Orchestrator] Current stage: ${this.session.stage}`);

    return this.continueFlow();
  }

  /**
   * Main flow execution
   */
  private async runFlow(userRequest: string): Promise<string> {
    if (!this.session) throw new Error('No active session');

    try {
      // Phase 1: Clarification
      await this.updateStage('clarification');
      const clarification = await this.runClarification(userRequest);

      // Handle conversational requests (greetings, help, questions)
      if (clarification.isConversational) {
        await this.updateStage('complete');
        console.log('[Orchestrator] Conversational request - no workflow needed');
        return clarification.response || 'How can I help you build an n8n workflow?';
      }

      // Phase 2: Research (if needed)
      let findings: ResearchFindings;
      if (clarification.needsResearch) {
        await this.updateStage('research');
        findings = await this.runResearch(clarification.researchQuery || userRequest);
      } else {
        // Simple workflow - minimal research
        findings = {
          hypothesis: clarification.requirements,
          hypothesis_validated: true,
          fit_score: 80,
          templates_found: [],
          nodes_found: [],
          existing_workflows: [],
        };
      }

      // Phase 3: Decision
      await this.updateStage('decision');
      const decision = await this.runDecision(findings);

      // GATE 2: Validate blueprint before proceeding
      if (!this.validateBlueprint(decision.blueprint)) {
        console.error('[Orchestrator] GATE 2 FAILED: Invalid blueprint');
        await this.updateStage('blocked');
        return 'Cannot proceed: Blueprint validation failed. Please provide more details about the workflow you want to build.';
      }

      // Phase 4: Credentials
      await this.updateStage('credentials');
      await this.runCredentials(decision.blueprint.credentials_needed);

      // Phase 5: Implementation (deep dive)
      await this.updateStage('implementation');
      await this.runImplementation(findings);

      // Phase 6: Build + QA Loop
      await this.updateStage('build');
      return this.runBuildPhase(decision.blueprint);
    } catch (error) {
      console.error('[Orchestrator] Flow error:', error);
      await this.updateStage('blocked');
      return this.runPostMortem();
    }
  }

  /**
   * GATE 2: Validate blueprint before Builder
   * L-110: Also validates minimum node count if user specified
   */
  private validateBlueprint(blueprint: BlueprintResult): boolean {
    if (!blueprint) {
      console.error('[Orchestrator] GATE 2 FAILED: Blueprint is null/undefined');
      return false;
    }
    if (!blueprint.workflow_name || blueprint.workflow_name.trim() === '') {
      console.error('[Orchestrator] GATE 2 FAILED: Missing workflow_name');
      return false;
    }
    if (!blueprint.nodes || !Array.isArray(blueprint.nodes) || blueprint.nodes.length === 0) {
      console.error('[Orchestrator] GATE 2 FAILED: No nodes in blueprint');
      return false;
    }
    if (!('credentials_needed' in blueprint)) {
      console.error('[Orchestrator] GATE 2 FAILED: Missing credentials_needed field');
      return false;
    }

    // L-110: Validate minimum node count if user specified
    const requiredNodeCount = this.session?.requirements?.nodeCount;
    if (requiredNodeCount && blueprint.nodes.length < requiredNodeCount) {
      console.error(`[Orchestrator] GATE 2 FAILED: User requested ${requiredNodeCount} nodes, blueprint has only ${blueprint.nodes.length}`);
      return false;
    }

    console.log(`[Orchestrator] GATE 2 PASSED: Blueprint "${blueprint.workflow_name}" with ${blueprint.nodes.length} nodes`);
    return true;
  }

  /**
   * Continue flow from current stage
   */
  private async continueFlow(): Promise<string> {
    if (!this.session) throw new Error('No active session');

    switch (this.session.stage) {
      case 'clarification':
        return this.runFlow(''); // Need user input
      case 'research':
        return this.runFlow(''); // Continue from research
      case 'build':
      case 'validate':
      case 'test':
        // Cannot resume build phase without blueprint - require new session
        console.error('[Orchestrator] Cannot resume build phase - no blueprint available');
        await this.updateStage('blocked');
        return 'Cannot resume: Blueprint not available. Please start a new session.';
      case 'blocked':
        return this.runPostMortem();
      case 'complete':
        return 'Session already complete';
      default:
        return 'Unknown stage';
    }
  }

  /**
   * Phase 1: Clarification
   */
  private async runClarification(userRequest: string): Promise<ClarificationResult> {
    console.log('[Orchestrator] Phase 1: Clarification');

    await architectAgent.initialize();
    const result = await architectAgent.clarify(this.session!, userRequest);

    // Store requirements in session for GATE 2 validation
    if (result.nodeCount || result.explicitRequirements) {
      this.session!.requirements = {
        nodeCount: result.nodeCount,
        explicitRequirements: result.explicitRequirements,
      };
      console.log(`[Orchestrator] Requirements stored: nodeCount=${result.nodeCount}`);
    }

    console.log(`[Orchestrator] Clarification complete. Needs research: ${result.needsResearch}`);
    return result;
  }

  /**
   * Phase 2: Research
   */
  private async runResearch(query: string): Promise<ResearchFindings> {
    console.log('[Orchestrator] Phase 2: Research');

    await researcherAgent.initialize();
    const findings = await researcherAgent.search(this.session!, query);

    // GATE 6: Validate hypothesis
    if (findings.hypothesis) {
      const validation = await researcherAgent.validateHypothesis(
        this.session!,
        findings.hypothesis
      );
      findings.hypothesis_validated = validation.validated;
    }

    console.log(`[Orchestrator] Research complete. Fit score: ${findings.fit_score}`);
    return findings;
  }

  /**
   * Phase 3: Decision
   * L-111: Now includes user confirmation checkpoint
   */
  private async runDecision(findings: ResearchFindings): Promise<{
    options: OptionsResult;
    blueprint: BlueprintResult;
  }> {
    console.log('[Orchestrator] Phase 3: Decision');

    // Present options to user
    const options = await architectAgent.presentOptions(this.session!, findings);

    // Interactive mode: let user select option
    const selectedOption = process.env.INTERACTIVE_MODE === 'true'
      ? await ui.selectOption(options)
      : options.options[0]?.id || 'A';

    console.log(`[Orchestrator] Selected option: ${selectedOption}`);

    // Create blueprint with explicit requirements passed through
    const blueprint = await architectAgent.createBlueprint(
      this.session!,
      selectedOption,
      findings
    );

    // Interactive mode: get user confirmation
    if (process.env.INTERACTIVE_MODE === 'true') {
      const confirmed = await ui.confirmBlueprint(blueprint);

      if (!confirmed) {
        console.log('[Orchestrator] Blueprint rejected by user');
        throw new Error('User rejected blueprint. Please refine requirements.');
      }
    }

    // Check if blueprint meets requirements
    const requiredNodes = this.session?.requirements?.nodeCount;
    if (requiredNodes && blueprint.nodes.length < requiredNodes) {
      console.warn(`[Orchestrator] WARNING: Blueprint has ${blueprint.nodes.length} nodes, user requested ${requiredNodes}`);
    }

    console.log(`[Orchestrator] Blueprint created: ${blueprint.workflow_name}`);
    return { options, blueprint };
  }

  /**
   * Phase 4: Credentials
   */
  private async runCredentials(neededTypes: string[]): Promise<void> {
    console.log('[Orchestrator] Phase 4: Credentials');

    if (neededTypes.length === 0) {
      console.log('[Orchestrator] No credentials needed');
      return;
    }

    // Discover credentials
    const discovered = await researcherAgent.discoverCredentials(
      this.session!,
      neededTypes
    );

    // Let architect present to user
    await architectAgent.selectCredentials(
      this.session!,
      discovered,
      neededTypes
    );

    console.log(`[Orchestrator] Credentials configured: ${discovered.length}`);
  }

  /**
   * Phase 5: Implementation (deep dive)
   */
  private async runImplementation(findings: ResearchFindings): Promise<void> {
    console.log('[Orchestrator] Phase 5: Implementation prep');

    // Researcher does deep dive for build guidance
    // This is already captured in findings
    console.log('[Orchestrator] Build guidance ready');
  }

  /**
   * Phase 6: Build + QA Loop
   */
  private async runBuildPhase(blueprint: BlueprintResult): Promise<string> {
    console.log('[Orchestrator] Phase 6: Build + QA Loop');

    await builderAgent.initialize();
    await qaAgent.initialize();

    // Initial build
    await this.updateStage('build');
    let buildResult = await builderAgent.build(this.session!, blueprint);

    if (!buildResult.workflow_id) {
      console.error('[Orchestrator] Build failed - no workflow ID');
      await this.updateStage('blocked');
      return this.runPostMortem();
    }

    // Set workflow ID in session
    await sessionManager.setWorkflowId(this.session!.id, buildResult.workflow_id);

    // QA Loop
    return this.runQALoop(buildResult);
  }

  /**
   * QA Loop with progressive escalation
   */
  private async runQALoop(buildResult: BuildResult): Promise<string> {
    const maxCycles = 7;

    while (this.session!.cycle < maxCycles) {
      // Increment cycle
      const cycle = await sessionManager.incrementCycle(this.session!.id);
      this.session!.cycle = cycle;
      console.log(`[Orchestrator] QA Cycle ${cycle}/${maxCycles}`);

      // Check GATE 1: Progressive escalation
      const escalation = gateEnforcer.getEscalationLevel(cycle);
      console.log(`[Orchestrator] Escalation level: ${escalation.level}`);

      // Run escalation if needed
      if (escalation.level === 'L2' || escalation.level === 'L3') {
        await this.runEscalation(escalation.level, buildResult.workflow_id);
      }

      // Validate
      await this.updateStage('validate');
      const qaReport = await qaAgent.validate(this.session!, buildResult.workflow_id);

      // Check GATE 3: Phase 5 testing
      const gate3 = await gateEnforcer.checkPhase5Testing(qaReport);
      if (!gate3.passed) {
        console.warn('[Orchestrator] GATE 3 violation - Phase 5 not executed');
        // Force Phase 5
        await qaAgent.testWorkflow(this.session!, buildResult.workflow_id);
      }

      // Check result
      if (qaReport.status === 'PASS') {
        await this.updateStage('complete');
        console.log('[Orchestrator] Workflow validated successfully!');
        return `SUCCESS: Workflow ${buildResult.workflow_id} is ready`;
      }

      if (qaReport.status === 'BLOCKED') {
        await this.updateStage('blocked');
        return this.runPostMortem();
      }

      // FAIL - need to fix
      console.log(`[Orchestrator] QA FAIL - ${qaReport.errors.length} errors`);

      // Check GATE 5 before proceeding
      const gate5 = await gateEnforcer.verifyMCPCalls(this.session!, 'builder');
      if (!gate5.passed) {
        console.warn('[Orchestrator] GATE 5 violation:', gate5.message);
      }

      // Fix with Builder
      await this.updateStage('build');
      buildResult = await builderAgent.fix(
        this.session!,
        buildResult.workflow_id,
        qaReport.edit_scope,
        qaReport.errors.map(e => e.message).join('\n')
      );
    }

    // Max cycles exceeded
    console.log('[Orchestrator] Max cycles exceeded - triggering L4');
    await this.updateStage('blocked');
    return this.runPostMortem();
  }

  /**
   * Run escalation (L2/L3)
   */
  private async runEscalation(
    level: 'L2' | 'L3',
    workflowId: string
  ): Promise<void> {
    console.log(`[Orchestrator] Running ${level} escalation`);

    if (level === 'L2') {
      // Targeted debug - execution analysis
      await researcherAgent.analyzeExecution(this.session!, workflowId);
    } else if (level === 'L3') {
      // Deep dive - full investigation
      const fixAttempts = await sessionManager.getFixAttempts(this.session!.id);
      await researcherAgent.deepDive(
        this.session!,
        workflowId,
        fixAttempts.map(f => f.approach)
      );
    }
  }

  /**
   * Run post-mortem (L4)
   */
  private async runPostMortem(): Promise<string> {
    console.log('[Orchestrator] Running L4 Post-Mortem');

    await analystAgent.initialize();

    const report = await analystAgent.postMortem(
      this.session!,
      this.session!.workflowId || 'unknown'
    );

    // Write learnings
    for (const learning of report.proposed_learnings || []) {
      await analystAgent.writeLearning(learning);
    }

    // Update context
    for (const update of report.context_updates || []) {
      await analystAgent.updateContext(update);
    }

    // Generate user report
    const userReport = analystAgent.generateUserReport(report);

    // Archive session
    await sessionManager.archiveSession(this.session!.id);

    return `BLOCKED: Workflow could not be completed.\n\n${userReport}`;
  }

  /**
   * Update stage
   */
  private async updateStage(stage: Stage): Promise<void> {
    if (!this.session) return;
    await sessionManager.updateStage(this.session.id, stage);
    this.session.stage = stage;
    console.log(`[Orchestrator] Stage: ${stage}`);
  }

  /**
   * Get current session
   */
  getSession(): SessionContext | null {
    return this.session;
  }
}

export const orchestrator = new Orchestrator();
