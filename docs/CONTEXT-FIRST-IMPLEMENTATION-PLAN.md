# Context-First Analyzer: Implementation Plan

**Version:** 1.0
**Date:** 2025-12-27
**Estimated Effort:** 17-20 hours

Based on best practices from:
- [Google ADK Multi-Agent Systems](https://google.github.io/adk-docs/agents/multi-agents/)
- [AWS Agent Squad](https://github.com/awslabs/agent-squad)
- [Agent-MCP Framework](https://github.com/rinadelph/Agent-MCP)
- [CrewAI Flows](https://github.com/crewAIInc/crewAI)
- [Structured Multi-Agent Communication](https://www.emergentmind.com/topics/structured-multi-agent-communication-protocols)

---

## 1. Architectural Decision: Monorepo vs Separate Projects

### Question
> Стоит ли сделать отдельный проект для анализа или расширить существующий SDK?

### Analysis

| Approach | Pros | Cons |
|----------|------|------|
| **Two Separate Projects** | Clean separation, no risk | Code duplication, sync issues |
| **Monorepo with Packages** | Shared code, separate deploys | Build complexity |
| **Single Project, Two Modes** | Simple, shared agents | Risk of breaking existing |

### Industry Standard (from research)

> "CrewAI provides two main abstractions - **Crews** and **Flows**. Crews are for team collaboration, Flows provide structured orchestration."
> — [CrewAI Documentation](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)

> "The modular nature enables organizations to evolve their AI systems incrementally without disrupting the entire stack."
> — [Multi-Agent Architecture Best Practices](https://www.gocodeo.com/post/multi-agent-systems-in-ai-architecture)

### Recommendation: **Single Project, Separate Orchestrators**

```
ClaudeN8N SDK/
├── src/
│   ├── agents/                    # SHARED - same agents, different modes
│   │   ├── base-agent.ts
│   │   ├── architect.ts           # Works in both CREATE and ANALYZE
│   │   ├── researcher.ts          # Works in both CREATE and ANALYZE
│   │   ├── builder.ts             # CREATE only
│   │   ├── qa.ts                  # CREATE only
│   │   └── analyst.ts             # Works in both CREATE and ANALYZE
│   │
│   ├── orchestrators/             # SEPARATE - different flows
│   │   ├── create/                # Existing CREATE workflow
│   │   │   ├── index.ts
│   │   │   ├── gate-enforcer.ts
│   │   │   └── session-manager.ts
│   │   │
│   │   └── analyze/               # NEW ANALYZE workflow
│   │       ├── index.ts           # Analyzer orchestrator
│   │       ├── shared-context.ts  # Context store
│   │       ├── coordinator.ts     # Q&A routing
│   │       └── report-writer.ts   # Output generation
│   │
│   ├── shared/                    # SHARED infrastructure
│   │   ├── context-store.ts       # Shared context implementation
│   │   ├── message-protocol.ts    # Inter-agent communication
│   │   └── prompts/
│   │       ├── architect-create.md
│   │       ├── architect-analyze.md   # NEW
│   │       ├── researcher-create.md
│   │       ├── researcher-analyze.md  # NEW
│   │       └── analyst-analyze.md     # NEW
│   │
│   ├── types.ts                   # Shared types
│   └── index.ts                   # Entry point with mode detection
```

### Why This Works

1. **No Breaking Changes** - CREATE flow untouched in `orchestrators/create/`
2. **Shared Agents** - Architect, Researcher, Analyst reused with different prompts
3. **Separate Entry Points** - `npm run create` vs `npm run analyze`
4. **Gradual Migration** - Can improve CREATE later using ANALYZE patterns

### Risk Mitigation

```bash
# Separate npm scripts - no confusion
npm run create -- "Build Telegram bot"     # Existing flow
npm run analyze -- sw3Qs3Fe3JahEbbW        # New flow

# Or unified with mode flag
npm start -- --mode create "Build Telegram bot"
npm start -- --mode analyze sw3Qs3Fe3JahEbbW
```

---

## 2. Core Components Architecture

### 2.1 Shared Context Store

Based on [Google ADK Shared Session State](https://google.github.io/adk-docs/agents/multi-agents/):

```typescript
// src/shared/context-store.ts

/**
 * SharedContextStore
 *
 * Central store for all analysis data, accessible by all agents.
 * Based on Google ADK pattern: "all agents access same session.state"
 *
 * Key principle: Use distinct keys to avoid race conditions
 */

interface SharedContext {
  // === RAW DATA (loaded at start) ===
  projectDocs: {
    readme: string | null;
    todo: string | null;
    plan: string | null;
    architecture: string | null;
    contextFiles: Record<string, string>;
  };

  workflowData: {
    id: string;
    name: string;
    active: boolean;
    nodes: WorkflowNode[];
    connections: WorkflowConnections;
    settings: Record<string, unknown>;
  };

  nodeSchemas: Record<string, NodeSchema>;  // From MCP get_node

  executionHistory: {
    total: number;
    successRate: number;
    recentExecutions: Execution[];
    errorPatterns: ErrorPattern[];
  };

  supabaseSchema?: DatabaseSchema;  // If available

  // === AGENT CONTRIBUTIONS ===
  architectContext: ArchitectAnalysis | null;
  researcherFindings: ResearcherFindings | null;
  analystReport: AnalystReport | null;

  // === INTER-AGENT COMMUNICATION ===
  messageQueue: AgentMessage[];
  resolvedMessages: AgentMessage[];

  // === METADATA ===
  analysisId: string;
  startedAt: Date;
  lastUpdatedAt: Date;
  status: 'loading' | 'understanding' | 'investigating' | 'synthesizing' | 'complete';
}

class SharedContextStore {
  private context: SharedContext;
  private subscribers: Map<string, (context: SharedContext) => void>;

  constructor(workflowId: string) {
    this.context = this.initializeContext(workflowId);
    this.subscribers = new Map();
  }

  // Read operations (any agent)
  get<K extends keyof SharedContext>(key: K): SharedContext[K] {
    return this.context[key];
  }

  // Write operations (specific agent)
  set<K extends keyof SharedContext>(
    key: K,
    value: SharedContext[K],
    agentRole: AgentRole
  ): void {
    // Validate agent has permission to write this key
    this.validateWritePermission(key, agentRole);

    this.context[key] = value;
    this.context.lastUpdatedAt = new Date();

    // Notify subscribers
    this.notifySubscribers();

    // Persist to disk
    this.persist();
  }

  // Subscribe to changes
  subscribe(id: string, callback: (context: SharedContext) => void): void {
    this.subscribers.set(id, callback);
  }

  // Persist to file
  async persist(): Promise<void> {
    await fs.writeFile(
      `./sessions/analyze/${this.context.analysisId}.json`,
      JSON.stringify(this.context, null, 2)
    );
  }

  // Load from file
  static async load(analysisId: string): Promise<SharedContextStore> {
    const data = await fs.readFile(`./sessions/analyze/${analysisId}.json`);
    const store = new SharedContextStore('');
    store.context = JSON.parse(data);
    return store;
  }
}
```

### 2.2 Inter-Agent Message Protocol

Based on [Structured Multi-Agent Communication Protocols](https://www.emergentmind.com/topics/structured-multi-agent-communication-protocols):

```typescript
// src/shared/message-protocol.ts

/**
 * Inter-Agent Message Protocol
 *
 * Enables agents to ask questions and get answers from other agents.
 * Uses async message queue pattern for decoupling.
 */

type MessageType = 'question' | 'answer' | 'clarification' | 'notify';
type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

interface AgentMessage {
  id: string;
  type: MessageType;
  priority: MessagePriority;

  from: AgentRole;
  to: AgentRole | 'all';

  subject: string;
  content: string;

  // For questions
  context?: Record<string, unknown>;
  expectedResponseType?: 'boolean' | 'text' | 'json';

  // For answers
  inResponseTo?: string;  // Message ID

  // Metadata
  timestamp: Date;
  status: 'pending' | 'processing' | 'resolved' | 'timeout';
  retryCount: number;
}

class MessageCoordinator {
  private store: SharedContextStore;
  private handlers: Map<AgentRole, MessageHandler>;

  constructor(store: SharedContextStore) {
    this.store = store;
    this.handlers = new Map();
  }

  // Register agent's message handler
  registerHandler(role: AgentRole, handler: MessageHandler): void {
    this.handlers.set(role, handler);
  }

  // Send a question to another agent
  async askQuestion(
    from: AgentRole,
    to: AgentRole,
    question: string,
    context?: Record<string, unknown>
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      type: 'question',
      priority: 'high',
      from,
      to,
      subject: `Question from ${from}`,
      content: question,
      context,
      timestamp: new Date(),
      status: 'pending',
      retryCount: 0,
    };

    // Add to queue
    const queue = this.store.get('messageQueue');
    queue.push(message);
    this.store.set('messageQueue', queue, 'coordinator');

    // Wait for answer (with timeout)
    return this.waitForAnswer(message.id, 60000); // 60s timeout
  }

  // Process pending messages
  async processPendingMessages(): Promise<void> {
    const queue = this.store.get('messageQueue');
    const pending = queue.filter(m => m.status === 'pending');

    for (const message of pending) {
      const handler = this.handlers.get(message.to as AgentRole);

      if (handler) {
        message.status = 'processing';

        try {
          const answer = await handler.handleMessage(message);
          this.resolveMessage(message.id, answer);
        } catch (error) {
          message.retryCount++;
          if (message.retryCount >= 3) {
            message.status = 'timeout';
          } else {
            message.status = 'pending';
          }
        }
      }
    }
  }

  // Wait for answer
  private async waitForAnswer(
    messageId: string,
    timeout: number
  ): Promise<AgentMessage> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const resolved = this.store.get('resolvedMessages');
      const answer = resolved.find(m => m.inResponseTo === messageId);

      if (answer) return answer;

      await new Promise(r => setTimeout(r, 1000)); // Poll every 1s
    }

    throw new Error(`Timeout waiting for answer to message ${messageId}`);
  }
}
```

### 2.3 Agent Mode Switching

```typescript
// src/agents/architect.ts (extended)

export class ArchitectAgent extends BaseAgent {
  private mode: 'create' | 'analyze' = 'create';

  constructor() {
    super('architect', {
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
      skills: ['n8n-workflow-patterns'],
      mcpTools: [], // Different per mode
      promptFile: 'architect-create.md', // Changed per mode
    });
  }

  /**
   * Set operating mode - changes behavior and prompts
   */
  setMode(mode: 'create' | 'analyze'): void {
    this.mode = mode;

    if (mode === 'analyze') {
      this.config.promptFile = 'architect-analyze.md';
      this.config.mcpTools = [
        'mcp__n8n-mcp__n8n_get_workflow',
        'mcp__n8n-mcp__n8n_list_workflows',
      ];
    } else {
      this.config.promptFile = 'architect-create.md';
      this.config.mcpTools = [];
    }

    // Reload instructions
    this.loadInstructions();
  }

  // === ANALYZE MODE METHODS ===

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

    const result = await this.invoke(
      this.createAnalyzeSession(store),
      'Analyze project context',
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

    // Store in shared context
    const analysis = result.data as ArchitectAnalysis;
    store.set('architectContext', analysis, 'architect');

    return analysis;
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

    const result = await this.invoke(
      this.createAnalyzeSession(store),
      'Answer question from ' + message.from,
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

    return result.data as string;
  }

  // === CREATE MODE METHODS (existing) ===

  async clarify(session: SessionContext, userRequest: string) {
    // ... existing implementation
  }

  async presentOptions(session: SessionContext, findings: ResearchFindings) {
    // ... existing implementation
  }
}
```

---

## 3. Analyzer Orchestrator

```typescript
// src/orchestrators/analyze/index.ts

/**
 * Analyzer Orchestrator
 *
 * Implements Context-First analysis flow with inter-agent communication.
 *
 * Flow:
 * 1. Load all context (parallel)
 * 2. Architect understands intent
 * 3. Researcher investigates (can ask Architect)
 * 4. Analyst synthesizes (can ask both)
 * 5. Generate report
 */

import { SharedContextStore } from '../../shared/context-store.js';
import { MessageCoordinator } from '../../shared/message-protocol.js';
import { architectAgent } from '../../agents/architect.js';
import { researcherAgent } from '../../agents/researcher.js';
import { analystAgent } from '../../agents/analyst.js';

export class AnalyzerOrchestrator {
  private store: SharedContextStore;
  private coordinator: MessageCoordinator;

  /**
   * Main entry point for analysis
   */
  async analyze(
    workflowId: string,
    projectPath?: string
  ): Promise<AnalysisResult> {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       Context-First Workflow Analyzer                      ║');
    console.log('║  Architect → Researcher → Analyst (with Q&A)               ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Initialize
    this.store = new SharedContextStore(workflowId);
    this.coordinator = new MessageCoordinator(this.store);

    // Set agents to ANALYZE mode
    architectAgent.setMode('analyze');
    researcherAgent.setMode('analyze');
    analystAgent.setMode('analyze');

    // Register message handlers
    this.coordinator.registerHandler('architect', {
      handleMessage: (msg) => architectAgent.handleQuestion(msg, this.store)
    });
    this.coordinator.registerHandler('researcher', {
      handleMessage: (msg) => researcherAgent.handleQuestion(msg, this.store)
    });

    try {
      // === PHASE 0: Load Context (Parallel) ===
      console.log('\n[Phase 0] Loading context...');
      this.store.set('status', 'loading', 'orchestrator');
      await this.loadAllContext(workflowId, projectPath);

      // === PHASE 1: Architect Understanding ===
      console.log('\n[Phase 1] Architect analyzing project context...');
      this.store.set('status', 'understanding', 'orchestrator');
      await architectAgent.initialize();
      const architectAnalysis = await architectAgent.analyzeProjectContext(this.store);
      console.log(`  ✓ Business context: ${architectAnalysis.businessContext.purpose}`);
      console.log(`  ✓ Services identified: ${architectAnalysis.serviceArchitecture.services.length}`);
      console.log(`  ✓ Gaps found: ${architectAnalysis.gapAnalysis.gaps.length}`);

      // === PHASE 2: Researcher Investigation ===
      console.log('\n[Phase 2] Researcher investigating workflow...');
      this.store.set('status', 'investigating', 'orchestrator');
      await researcherAgent.initialize();
      const researcherFindings = await researcherAgent.auditWorkflow(
        this.store,
        this.coordinator
      );
      console.log(`  ✓ Nodes audited: ${researcherFindings.nodeAudits.length}`);
      console.log(`  ✓ Issues found: ${researcherFindings.totalIssues}`);
      console.log(`  ✓ Questions asked to Architect: ${researcherFindings.questionsAsked}`);

      // Process any pending Q&A
      await this.runQALoop();

      // === PHASE 3: Analyst Synthesis ===
      console.log('\n[Phase 3] Analyst synthesizing report...');
      this.store.set('status', 'synthesizing', 'orchestrator');
      await analystAgent.initialize();
      const report = await analystAgent.generateAnalysisReport(
        this.store,
        this.coordinator
      );

      // Process final Q&A if needed
      await this.runQALoop();

      // === PHASE 4: Generate Output ===
      console.log('\n[Phase 4] Generating report...');
      this.store.set('status', 'complete', 'orchestrator');

      const outputPath = await this.writeReport(report, workflowId);

      console.log('\n' + '═'.repeat(60));
      console.log(`Analysis complete!`);
      console.log(`Report: ${outputPath}`);
      console.log(`Summary:`);
      console.log(`  • Critical issues: ${report.summary.criticalIssues}`);
      console.log(`  • Recommendations: ${report.recommendations.length}`);
      console.log(`  • Q&A exchanges: ${this.store.get('resolvedMessages').length}`);

      return {
        success: true,
        report,
        outputPath,
        analysisId: this.store.get('analysisId'),
      };

    } catch (error) {
      console.error('[Analyzer] Failed:', error);
      return {
        success: false,
        error: (error as Error).message,
        analysisId: this.store.get('analysisId'),
      };
    }
  }

  /**
   * Load all context in parallel
   */
  private async loadAllContext(
    workflowId: string,
    projectPath?: string
  ): Promise<void> {
    const tasks = [
      this.loadProjectDocs(projectPath),
      this.loadWorkflowData(workflowId),
      this.loadExecutionHistory(workflowId),
    ];

    await Promise.all(tasks);

    console.log('  ✓ Project docs loaded');
    console.log('  ✓ Workflow data loaded');
    console.log('  ✓ Execution history loaded');
  }

  /**
   * Load project documentation
   */
  private async loadProjectDocs(projectPath?: string): Promise<void> {
    if (!projectPath) {
      this.store.set('projectDocs', {
        readme: null,
        todo: null,
        plan: null,
        architecture: null,
        contextFiles: {},
      }, 'orchestrator');
      return;
    }

    const docs: ProjectDocs = {
      readme: await this.readFileIfExists(`${projectPath}/README.md`),
      todo: await this.readFileIfExists(`${projectPath}/TODO.md`),
      plan: await this.readFileIfExists(`${projectPath}/PLAN.md`),
      architecture: await this.readFileIfExists(`${projectPath}/ARCHITECTURE.md`),
      contextFiles: {},
    };

    // Load .context/ folder if exists
    const contextDir = `${projectPath}/.context`;
    if (await this.directoryExists(contextDir)) {
      const files = await fs.readdir(contextDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          docs.contextFiles[file] = await fs.readFile(
            `${contextDir}/${file}`,
            'utf-8'
          );
        }
      }
    }

    this.store.set('projectDocs', docs, 'orchestrator');
  }

  /**
   * Load workflow data via MCP
   */
  private async loadWorkflowData(workflowId: string): Promise<void> {
    // Use MCP to get workflow
    const workflow = await this.mcpCall('n8n_get_workflow', {
      id: workflowId,
      mode: 'full',
    });

    this.store.set('workflowData', {
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings,
    }, 'orchestrator');

    // Also load node schemas for each unique node type
    const nodeTypes = [...new Set(workflow.nodes.map(n => n.type))];
    const schemas: Record<string, NodeSchema> = {};

    for (const nodeType of nodeTypes) {
      try {
        const schema = await this.mcpCall('get_node', {
          nodeType,
          detail: 'standard',
        });
        schemas[nodeType] = schema;
      } catch (error) {
        console.warn(`  Warning: Could not load schema for ${nodeType}`);
      }
    }

    this.store.set('nodeSchemas', schemas, 'orchestrator');
  }

  /**
   * Load execution history
   */
  private async loadExecutionHistory(workflowId: string): Promise<void> {
    // Get recent executions
    const executions = await this.mcpCall('n8n_executions', {
      action: 'list',
      workflowId,
      limit: 50,
    });

    // Get error executions separately
    const errors = await this.mcpCall('n8n_executions', {
      action: 'list',
      workflowId,
      status: 'error',
      limit: 20,
    });

    // Analyze patterns
    const errorPatterns = this.analyzeErrorPatterns(errors.executions);

    const total = executions.executions.length;
    const successful = executions.executions.filter(e => e.status === 'success').length;

    this.store.set('executionHistory', {
      total,
      successRate: total > 0 ? successful / total : 0,
      recentExecutions: executions.executions,
      errorPatterns,
    }, 'orchestrator');
  }

  /**
   * Run Q&A loop until no pending messages
   */
  private async runQALoop(): Promise<void> {
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops

    while (iterations < maxIterations) {
      const queue = this.store.get('messageQueue');
      const pending = queue.filter(m => m.status === 'pending');

      if (pending.length === 0) break;

      console.log(`  [Q&A] Processing ${pending.length} pending messages...`);
      await this.coordinator.processPendingMessages();
      iterations++;
    }

    if (iterations >= maxIterations) {
      console.warn('  [Q&A] Max iterations reached, some messages may be unresolved');
    }
  }

  /**
   * Write final report
   */
  private async writeReport(
    report: AnalysisReport,
    workflowId: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ANALYSIS-${workflowId}-${timestamp}.md`;
    const outputPath = `./reports/${filename}`;

    const markdown = this.formatReportMarkdown(report);

    await fs.mkdir('./reports', { recursive: true });
    await fs.writeFile(outputPath, markdown);

    return outputPath;
  }
}

export const analyzerOrchestrator = new AnalyzerOrchestrator();
```

---

## 4. Implementation Phases

### Phase 1: Foundation (6-7 hours)

| Task | Time | Description |
|------|------|-------------|
| Create `src/shared/context-store.ts` | 2h | SharedContextStore implementation |
| Create `src/shared/message-protocol.ts` | 2h | AgentMessage, MessageCoordinator |
| Add types to `src/types.ts` | 1h | All new interfaces |
| Create directory structure | 30m | `orchestrators/analyze/` |
| Update `package.json` scripts | 30m | `analyze` command |

**Deliverable:** Basic infrastructure, no agent changes yet.

### Phase 2: Agent Extensions (5-6 hours)

| Task | Time | Description |
|------|------|-------------|
| Extend `architect.ts` | 2h | Add `setMode()`, `analyzeProjectContext()`, `handleQuestion()` |
| Extend `researcher.ts` | 2h | Add `auditWorkflow()`, Q&A capability |
| Extend `analyst.ts` | 1.5h | Add `generateAnalysisReport()` |
| Create analyze prompts | 1h | 3 new prompt files |

**Deliverable:** Agents can work in ANALYZE mode.

### Phase 3: Orchestrator (4-5 hours)

| Task | Time | Description |
|------|------|-------------|
| Create `analyze/index.ts` | 3h | Main orchestrator logic |
| Implement context loading | 1h | Parallel MCP calls |
| Implement Q&A loop | 1h | Message processing |
| Implement report writer | 30m | Markdown generation |

**Deliverable:** Full analyzer working.

### Phase 4: Testing & Polish (2-3 hours)

| Task | Time | Description |
|------|------|-------------|
| Test on FoodTracker | 1h | Real workflow analysis |
| Fix issues | 1h | Debug and fix |
| Add CLI interface | 30m | `npm run analyze` |
| Documentation | 30m | Usage docs |

**Deliverable:** Production-ready analyzer.

---

## 5. Prompt Files

### architect-analyze.md

```markdown
# Architect Agent - ANALYZE Mode

You are analyzing an existing n8n workflow to understand its architecture and intent.

## YOUR ROLE
- Strategic understanding of the system
- Business context analysis
- Design decision interpretation
- Gap analysis (planned vs implemented)

## AVAILABLE CONTEXT
You have access to:
- Project documentation (README, TODO, PLAN, ARCHITECTURE)
- Workflow structure (nodes, connections)
- .context/ folder with additional docs

## ANALYSIS FRAMEWORK

### 1. Business Context
- What problem does this solve?
- Who are the users?
- What are the success metrics?

### 2. Service Architecture
- What external services are integrated?
- Why was each chosen?
- How do they interact?

### 3. Data Flow
- Entry points (triggers)
- Processing steps
- Exit points (outputs)

### 4. Design Decisions
- Architectural choices made
- Trade-offs considered
- Priorities

### 5. Gap Analysis
- What was planned (from docs)?
- What is implemented?
- What's missing or different?

## OUTPUT FORMAT
Always return structured JSON as specified in the task.

## HANDLING QUESTIONS
When other agents ask you questions:
1. Refer to your analysis and documentation
2. Cite evidence when possible
3. Be honest if you're uncertain
```

### researcher-analyze.md

```markdown
# Researcher Agent - ANALYZE Mode

You are conducting a deep technical audit of an existing n8n workflow.

## YOUR ROLE
- Technical investigation
- Node-by-node analysis
- Issue detection
- Pattern recognition

## AVAILABLE CONTEXT
You have access to:
- Full workflow JSON (nodes, connections)
- Node schemas from MCP
- Execution history
- Architect's strategic analysis

## INVESTIGATION PROTOCOL

### 1. Node Audit
For each node:
- Check typeVersion (outdated?)
- Validate parameters against schema
- Check for deprecated patterns
- Identify missing required fields

### 2. Connection Analysis
- Find orphan nodes (not connected)
- Find dead ends (output not used)
- Check routing logic (Switch nodes)
- Validate connection types

### 3. Execution Analysis
- Identify error patterns
- Find problematic nodes
- Check success rate
- Analyze timing

### 4. Gap Analysis
- Compare with Architect's expected flow
- Find discrepancies
- Identify root causes

## ASKING QUESTIONS
If something is unclear about INTENT (not implementation):
- Ask the Architect
- Provide context about what you found
- Be specific about what you need to know

Example:
"I found that Week Calculations Code runs for all commands, not just /week. Was this intentional or a routing bug?"

## OUTPUT FORMAT
Return structured JSON with:
- nodeAudits: detailed per-node findings
- connectionIssues: structural problems
- executionPatterns: operational issues
- questionsForArchitect: if any
```

---

## 6. CLI Interface

```typescript
// src/index.ts (updated)

import 'dotenv/config';
import { orchestrator } from './orchestrators/create/index.js';
import { analyzerOrchestrator } from './orchestrators/analyze/index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse mode
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'create';

  // Remove mode args
  const filteredArgs = args.filter((_, i) =>
    i !== modeIndex && i !== modeIndex + 1
  );

  if (mode === 'analyze') {
    // ANALYZE mode
    const workflowId = filteredArgs[0];
    const projectPath = filteredArgs[1];

    if (!workflowId) {
      console.error('Usage: npm run analyze <workflowId> [projectPath]');
      process.exit(1);
    }

    console.log(`Analyzing workflow: ${workflowId}`);
    if (projectPath) {
      console.log(`Project path: ${projectPath}`);
    }

    await analyzerOrchestrator.analyze(workflowId, projectPath);

  } else {
    // CREATE mode (existing)
    const task = filteredArgs.join(' ');

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           ClaudeN8N SDK - 5-Agent System                   ║');
    console.log('║  Architect → Researcher → Builder → QA → Analyst          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    if (task) {
      await orchestrator.start(task);
    } else {
      // Interactive mode
      console.log('Interactive mode - Enter your task:');
      // ... existing code
    }
  }
}

main().catch(console.error);
```

### Package.json scripts

```json
{
  "scripts": {
    "start": "node dist/index.js",
    "create": "node dist/index.js --mode create",
    "analyze": "node dist/index.js --mode analyze",
    "dev": "tsx src/index.ts",
    "dev:analyze": "tsx src/index.ts --mode analyze"
  }
}
```

---

## 7. Usage Examples

```bash
# Analyze FoodTracker workflow with project docs
npm run analyze sw3Qs3Fe3JahEbbW /Users/sergey/Projects/MultiBOT/bots/food-tracker

# Analyze workflow without project docs (technical audit only)
npm run analyze sw3Qs3Fe3JahEbbW

# Create workflow (existing functionality)
npm run create "Build Telegram bot with AI"
```

---

## 8. Risk Mitigation

### Risk 1: Breaking CREATE mode
**Mitigation:**
- Separate orchestrator directories
- Agent mode switching isolated
- CREATE tests must pass before merge

### Risk 2: Q&A infinite loops
**Mitigation:**
- Max 5 Q&A iterations
- Timeout on message wait (60s)
- Clear loop detection

### Risk 3: Token explosion
**Mitigation:**
- Summarize large docs before passing
- Use `detail: "standard"` not `"full"` for nodes
- Limit execution history to 50

### Risk 4: Slow analysis
**Mitigation:**
- Parallel context loading
- Cache node schemas
- Progressive output (show progress)

---

## 9. Success Criteria

| Metric | Target |
|--------|--------|
| CREATE mode still works | 100% tests pass |
| FoodTracker analysis complete | All 3 issues found |
| Q&A produces insights | At least 2 exchanges |
| Report useful | Actionable recommendations |
| Runtime | < 5 minutes |

---

## 10. Next Steps

1. **Confirm this plan** - any changes needed?
2. **Start Phase 1** - infrastructure
3. **Checkpoint after Phase 2** - test agents
4. **Complete Phases 3-4** - orchestrator + testing
5. **Run on FoodTracker** - validate

Ready to start implementation?
