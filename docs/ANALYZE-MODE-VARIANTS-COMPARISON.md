# Analyze Mode: Detailed Variants Comparison

Based on industry research and best practices from [CrewAI](https://github.com/crewAIInc/crewAI), [AutoGen](https://medium.com/@rohitobrai11/llm-powered-multi-agent-systems-a-comparative-analysis-of-crew-ai-autogen-and-langraph-f3ff50182504), [Google ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/), and [DeepLearning.AI Agentic Knowledge Graph](https://www.deeplearning.ai/short-courses/agentic-knowledge-graph-construction/).

---

## Variant A: 3-Phase Sequential Analysis

### Architecture
```
┌──────────────────────────────────────────────────────────────┐
│                     USER REQUEST                              │
│                  "Analyze workflow X"                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE 1: ARCHITECT                                           │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Reads:                                                       │
│   • Project documentation (README, TODO, PLAN, etc.)         │
│   • Workflow JSON (high-level: node names, connections)      │
│                                                              │
│ Outputs:                                                     │
│   • Business Context (what system does, for whom)            │
│   • Service Map (what services used, why)                    │
│   • Expected Data Flow                                       │
│   • Design Decisions (why built this way)                    │
│                                                              │
│ Time: ~30-60 seconds                                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼ (passes context)
┌──────────────────────────────────────────────────────────────┐
│ PHASE 2: RESEARCHER                                          │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Receives: Architect's context                                │
│                                                              │
│ Actions:                                                     │
│   • get_node() for each node (versions, schemas)             │
│   • validate_workflow() (structure)                          │
│   • n8n_executions() (error patterns)                        │
│   • Compare implementation vs Architect's expected flow      │
│                                                              │
│ Outputs:                                                     │
│   • Node audits with issues                                  │
│   • Execution analysis                                       │
│   • Gap Analysis (intent vs reality)                         │
│                                                              │
│ Time: ~60-120 seconds                                        │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼ (passes findings)
┌──────────────────────────────────────────────────────────────┐
│ PHASE 3: ANALYST                                             │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Receives: Architect context + Researcher findings            │
│                                                              │
│ Actions:                                                     │
│   • Prioritize issues (P0/P1/P2)                            │
│   • Root cause analysis                                      │
│   • Generate recommendations                                 │
│   • Create implementation roadmap                            │
│   • Write report                                             │
│                                                              │
│ Outputs:                                                     │
│   • Structured AuditReport                                   │
│   • Markdown report file                                     │
│                                                              │
│ Time: ~30-60 seconds                                         │
└──────────────────────────────────────────────────────────────┘
```

### Pros
1. **Simple to implement** - linear flow, no complex coordination
2. **Clear handoffs** - each agent has defined input/output
3. **Easy to debug** - can see exactly where things went wrong
4. **Lower token usage** - each agent runs once
5. **Predictable timing** - ~3-5 minutes total

### Cons
1. **Information loss** - context compressed between phases
2. **No backtracking** - if Researcher finds Architect missed something, can't go back
3. **Limited depth** - Architect doesn't see technical details
4. **One-way knowledge** - Researcher can't ask Architect clarifying questions

### Implementation Complexity
| Component | Effort | Description |
|-----------|--------|-------------|
| Types | 30 min | Add ArchitectContext, ResearcherFindings |
| Architect method | 1 hour | analyzeProjectContext() |
| Researcher method | 1.5 hours | auditWorkflow() with context |
| Analyst method | 1 hour | generateReport() |
| Orchestrator | 30 min | analyze() flow |
| Prompts | 1 hour | 3 prompt files |
| **Total** | **5-6 hours** | |

### When to Use
- Quick audits where speed matters
- Well-documented projects
- Simpler workflows (<30 nodes)

---

## Variant B: Multi-Layer Analysis

### Architecture
```
┌──────────────────────────────────────────────────────────────┐
│                     USER REQUEST                              │
│                  "Analyze workflow X"                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ LAYER 1: BUSINESS (Architect)                                │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ "What should this system do?"                                │
│                                                              │
│ Analyzes:                                                    │
│   • User stories / use cases                                 │
│   • Business requirements                                    │
│   • Success metrics                                          │
│   • Target users                                             │
│                                                              │
│ Output: BusinessLayerAnalysis                                │
│   {                                                          │
│     purpose: "Food tracking for single user",                │
│     users: ["Sergey"],                                       │
│     useCases: ["log food", "get reports", "manage meals"],   │
│     successMetrics: ["response time", "accuracy"]            │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ LAYER 2: ARCHITECTURE (Architect + Researcher)               │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ "How is this system organized?"                              │
│                                                              │
│ Analyzes:                                                    │
│   • Component diagram                                        │
│   • Service integrations (Telegram, OpenAI, Supabase)        │
│   • Data model (tables, relationships)                       │
│   • Security model (auth, credentials)                       │
│   • Error handling strategy                                  │
│                                                              │
│ Output: ArchitectureLayerAnalysis                            │
│   {                                                          │
│     services: [                                              │
│       { name: "Telegram", role: "user interface" },          │
│       { name: "OpenAI", role: "AI processing" },             │
│       { name: "Supabase", role: "data storage" }             │
│     ],                                                       │
│     dataFlow: "User → Telegram → AI → Supabase → Response",  │
│     securityModel: "single user, hardcoded ID"               │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ LAYER 3: IMPLEMENTATION (Researcher)                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ "How is this implemented?"                                   │
│                                                              │
│ Analyzes:                                                    │
│   • Node-by-node deep dive                                   │
│   • Code quality (in Code nodes)                             │
│   • Expression correctness                                   │
│   • Connection logic                                         │
│   • Version compatibility                                    │
│                                                              │
│ Output: ImplementationLayerAnalysis                          │
│   {                                                          │
│     nodes: [...detailed audit...],                           │
│     codeQuality: { issues: [...] },                          │
│     expressions: { errors: [...] }                           │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ LAYER 4: OPERATIONS (Researcher + Analyst)                   │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ "How does this work in production?"                          │
│                                                              │
│ Analyzes:                                                    │
│   • Execution success rate                                   │
│   • Error patterns                                           │
│   • Performance metrics                                      │
│   • Reliability issues                                       │
│                                                              │
│ Output: OperationsLayerAnalysis                              │
│   {                                                          │
│     successRate: 0.85,                                       │
│     commonErrors: ["empty text", "timeout"],                 │
│     performance: { avgTime: "4.7s", target: "3s" }           │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ SYNTHESIS (Analyst)                                          │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ "What needs to change?"                                      │
│                                                              │
│ Actions:                                                     │
│   • Cross-layer gap analysis                                 │
│   • Identify cross-cutting concerns                          │
│   • Prioritize by layer importance                           │
│   • Create layer-aware roadmap                               │
│                                                              │
│ Output: MultiLayerReport                                     │
│   {                                                          │
│     businessGaps: [...],                                     │
│     architectureGaps: [...],                                 │
│     implementationGaps: [...],                               │
│     operationsGaps: [...],                                   │
│     crossCuttingIssues: [...],                               │
│     roadmap: [...]                                           │
│   }                                                          │
└──────────────────────────────────────────────────────────────┘
```

### Pros
1. **Comprehensive coverage** - no blind spots
2. **Structured output** - easy to understand for stakeholders
3. **Layer isolation** - can run individual layers independently
4. **Better prioritization** - business issues > architecture > implementation
5. **Enterprise-ready** - matches how organizations think

### Cons
1. **More complex** - 5 distinct analysis phases
2. **Longer runtime** - each layer takes time
3. **Potential redundancy** - some overlap between layers
4. **More tokens** - each layer = separate LLM call
5. **Some layers may be thin** - not every project has all layers

### Implementation Complexity
| Component | Effort | Description |
|-----------|--------|-------------|
| Types | 1 hour | Add all layer types |
| Business Layer | 1 hour | Architect business analysis |
| Architecture Layer | 1.5 hours | Combined Architect+Researcher |
| Implementation Layer | 1.5 hours | Researcher deep dive |
| Operations Layer | 1 hour | Execution analysis |
| Synthesis | 1.5 hours | Cross-layer analysis |
| Orchestrator | 1 hour | Multi-layer flow |
| Prompts | 2 hours | 5 prompt files |
| **Total** | **10-12 hours** | |

### When to Use
- Enterprise projects
- Stakeholder presentations
- Projects with mixed technical/business audiences
- Long-term roadmap planning

---

## Variant C: Context-First Collaborative Analysis

### Architecture (Based on [Google ADK Shared State](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) + [DeepLearning.AI Agentic KG](https://www.deeplearning.ai/short-courses/agentic-knowledge-graph-construction/))

```
┌──────────────────────────────────────────────────────────────┐
│                     USER REQUEST                              │
│                  "Analyze workflow X"                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌══════════════════════════════════════════════════════════════┐
║                    SHARED CONTEXT STORE                       ║
║ ═══════════════════════════════════════════════════════════  ║
║                                                               ║
║  {                                                            ║
║    projectDocs: { ... },      // Loaded docs                  ║
║    workflowData: { ... },     // Workflow JSON                ║
║    nodeSchemas: { ... },      // Node details from MCP        ║
║    executions: { ... },       // Execution history            ║
║    supabaseSchema: { ... },   // Database schema              ║
║                                                               ║
║    // Agent contributions:                                    ║
║    architectContext: null,    // Filled by Architect          ║
║    researcherFindings: null,  // Filled by Researcher         ║
║    analystReport: null,       // Filled by Analyst            ║
║                                                               ║
║    // Cross-agent queries:                                    ║
║    pendingQuestions: [],      // Questions between agents     ║
║    resolvedAnswers: []        // Answers from agents          ║
║  }                                                            ║
║                                                               ║
╚══════════════════════════════════════════════════════════════╝
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│                 │ │                 │ │                 │
│   ARCHITECT     │ │   RESEARCHER    │ │    ANALYST      │
│                 │ │                 │ │                 │
│ Reads:          │ │ Reads:          │ │ Reads:          │
│ • projectDocs   │ │ • workflowData  │ │ • ALL context   │
│ • workflowData  │ │ • nodeSchemas   │ │                 │
│ (high level)    │ │ • executions    │ │ Waits for:      │
│                 │ │ • architectCtx  │ │ • architectCtx  │
│ Writes:         │ │                 │ │ • researcherF.  │
│ • architectCtx  │ │ Writes:         │ │                 │
│                 │ │ • researcherF.  │ │ Writes:         │
│ Can ask:        │ │                 │ │ • analystReport │
│ • Researcher    │ │ Can ask:        │ │                 │
│   for details   │ │ • Architect     │ │ Can ask:        │
│                 │ │   for intent    │ │ • Both agents   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    COORDINATOR                                │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ Manages:                                                     │
│   • Agent execution order (can be parallel or sequential)    │
│   • Question routing between agents                          │
│   • Context synchronization                                  │
│   • Completion detection                                     │
│                                                              │
│ Flow:                                                        │
│   1. Initialize shared context with raw data                 │
│   2. Run Architect (fills architectContext)                  │
│   3. Check for pending questions → route to answerer         │
│   4. Run Researcher (with Architect's context)               │
│   5. Check for questions → maybe re-run Architect            │
│   6. Run Analyst (with full context)                         │
│   7. If Analyst has questions → iterate                      │
│   8. Generate final report                                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Key Innovation: Inter-Agent Communication

```
┌─────────────────────────────────────────────────────────────┐
│ QUESTION-ANSWER PROTOCOL                                     │
│                                                              │
│ Researcher finds: "Week Calculations Code runs for all      │
│                    commands, not just /week"                 │
│                                                              │
│ Researcher asks Architect:                                   │
│   {                                                          │
│     from: "researcher",                                      │
│     to: "architect",                                         │
│     question: "Was Week Calculations intended for           │
│                all commands or only /week?",                 │
│     context: { nodeFound: "Week Calculations Code",          │
│                connections: [...] }                          │
│   }                                                          │
│                                                              │
│ Architect answers:                                           │
│   {                                                          │
│     from: "architect",                                       │
│     to: "researcher",                                        │
│     answer: "Based on TODO.md Task 2.6, Week Calculations   │
│              was added specifically for /week non-          │
│              determinism bug. It should ONLY run for        │
│              /week. This is a routing bug.",                │
│     evidence: "TODO.md line 245: 'Fix /week non-determinism'│
│   }                                                          │
│                                                              │
│ Now Researcher can mark this as HIGH priority issue with    │
│ root cause: "Routing misconfiguration, not code bug"        │
└─────────────────────────────────────────────────────────────┘
```

### Memory Architecture (Based on [Agentic RAG](https://medium.com/@dewasheesh.rana/by-dewasheesh-rana-b8404b0acb85))

```
┌──────────────────────────────────────────────────────────────┐
│                    HIERARCHICAL MEMORY                        │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│ SHORT-TERM (per agent, per call):                            │
│   • Current task context                                     │
│   • Recent tool outputs                                      │
│   • Working conclusions                                      │
│                                                              │
│ SESSION (shared, this analysis):                             │
│   • All loaded documents                                     │
│   • Agent contributions                                      │
│   • Q&A history                                              │
│                                                              │
│ LONG-TERM (persisted):                                       │
│   • Previous analyses of this workflow                       │
│   • LEARNINGS.md patterns                                    │
│   • Known issues database                                    │
│                                                              │
│ REFLECTIVE (agent self-summaries):                           │
│   • "I found 3 critical issues related to routing"           │
│   • "Architecture decision unclear - asked Architect"        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Pros
1. **Deepest understanding** - agents can clarify with each other
2. **No information loss** - shared context available to all
3. **Adaptive** - can iterate until all questions resolved
4. **Root cause accuracy** - cross-referencing intent vs implementation
5. **Closest to human analysis** - like a team discussing a project
6. **Knowledge accumulation** - builds understanding over iterations

### Cons
1. **Most complex** - requires coordinator, message passing
2. **Unpredictable runtime** - depends on how many iterations needed
3. **Higher token usage** - multiple agent calls possible
4. **Potential infinite loops** - agents keep asking each other
5. **Harder to debug** - distributed state

### Implementation Complexity
| Component | Effort | Description |
|-----------|--------|-------------|
| Types | 1.5 hours | SharedContext, Question, Answer, etc. |
| SharedContextStore | 2 hours | In-memory store with persistence |
| Coordinator | 3 hours | Agent orchestration, Q&A routing |
| Architect methods | 2 hours | Context analysis + Q&A handlers |
| Researcher methods | 2 hours | Audit + Q&A handlers |
| Analyst methods | 1.5 hours | Report + Q&A handlers |
| Inter-agent protocol | 2 hours | Message format, routing |
| Iteration logic | 1.5 hours | Convergence detection |
| Prompts | 2 hours | 3 prompts with Q&A instructions |
| **Total** | **17-20 hours** | |

### When to Use
- Complex, poorly documented projects
- Projects where intent vs implementation diverged
- When you need "why" not just "what"
- Research-grade analysis
- Building project documentation from scratch

---

## Comparison Summary

| Aspect | Variant A | Variant B | Variant C |
|--------|-----------|-----------|-----------|
| **Depth** | Medium | High | Very High |
| **Speed** | Fast (3-5 min) | Medium (8-12 min) | Variable (10-30 min) |
| **Complexity** | Low | Medium | High |
| **Implementation** | 5-6 hours | 10-12 hours | 17-20 hours |
| **Token Usage** | Low | Medium | High |
| **Accuracy** | Good | Very Good | Excellent |
| **Inter-agent Comm** | None | Minimal | Full |
| **Backtracking** | No | Limited | Yes |
| **Best For** | Quick audits | Enterprise | Deep understanding |

---

## Industry Validation

### Google ADK Pattern
From [Google's Agent Development Kit](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/):
> "Multiple agents have access to a shared context... A user intent agent collaborates with the user to define the goal... and saves the approved goal in the shared state."

**Variant C follows this pattern** with SharedContextStore.

### CrewAI Approach
From [CrewAI Framework](https://github.com/crewAIInc/crewAI):
> "Agents can communicate in a hierarchical pattern where the essential agent will handle easy questions while superior agents will handle complex questions."

**Variant C uses hierarchical Q&A** - Researcher asks Architect about intent.

### DeepLearning.AI Agentic KG
From [Agentic Knowledge Graph Construction](https://www.deeplearning.ai/short-courses/agentic-knowledge-graph-construction/):
> "A multi-agent system made up of a conversational agent that identifies the user's goal, and three sub-agentic workflows... agents have access to a shared context."

**Variant C mirrors this** with shared state + specialized agents.

### Multi-Agent Collaboration Research
From [Enterprise GenAI Multi-Agent Research](https://arxiv.org/html/2412.05449v1):
> "Multi-agent collaboration integrates the complementary capabilities and expertise of agents with different specializations, making it highly effective for addressing complex tasks."

**All variants use specialization**, but C maximizes collaboration.

---

## My Recommendation

**For FoodTracker Analysis: Start with Variant A, Evolve to C**

### Phase 1: Implement Variant A (5-6 hours)
- Get working analysis quickly
- Learn what works, what's missing
- Identify where inter-agent communication would help

### Phase 2: Add Shared Context (3-4 hours)
- Add SharedContextStore
- Keep sequential execution
- Now agents can read each other's findings

### Phase 3: Add Q&A Protocol (5-6 hours)
- Add question-answer capability
- Enable iterations
- Full Variant C

**Total: Same 17-20 hours, but with working intermediate versions**

---

## Variant D (Hybrid) - Recommended Final Architecture

Based on all research, the optimal architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                     PARALLEL CONTEXT LOADING                  │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│  [Load Docs]    [Load Workflow]    [Load Executions]         │
│       │               │                   │                  │
│       └───────────────┴───────────────────┘                  │
│                       │                                      │
│                       ▼                                      │
│              SHARED CONTEXT STORE                            │
└──────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     PHASE 1: UNDERSTANDING                    │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│              ┌─────────────────────────┐                     │
│              │       ARCHITECT         │                     │
│              │  Strategic Understanding │                     │
│              └─────────────────────────┘                     │
│                         │                                    │
│                         ▼                                    │
│              Writes to SharedContext:                        │
│              • businessContext                               │
│              • serviceMap                                    │
│              • expectedDataFlow                              │
│              • designDecisions                               │
└──────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     PHASE 2: INVESTIGATION                    │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│              ┌─────────────────────────┐                     │
│              │       RESEARCHER        │                     │
│              │    Technical Deep Dive   │                     │
│              └─────────────────────────┘                     │
│                         │                                    │
│                         │ ←── Reads Architect's context      │
│                         │                                    │
│                         ▼                                    │
│              If unclear about intent:                        │
│              ┌─────────────────────────┐                     │
│              │  ASK ARCHITECT          │ ◄─── Q&A Loop       │
│              │  (via Coordinator)      │                     │
│              └─────────────────────────┘                     │
│                         │                                    │
│                         ▼                                    │
│              Writes to SharedContext:                        │
│              • nodeAudits                                    │
│              • executionAnalysis                             │
│              • gapAnalysis (intent vs reality)               │
└──────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                     PHASE 3: SYNTHESIS                        │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                              │
│              ┌─────────────────────────┐                     │
│              │        ANALYST          │                     │
│              │    Report Generation     │                     │
│              └─────────────────────────┘                     │
│                         │                                    │
│                         │ ←── Reads ALL context              │
│                         │                                    │
│                         ▼                                    │
│              If needs clarification:                         │
│              ┌─────────────────────────┐                     │
│              │  ASK ARCHITECT or       │ ◄─── Final Q&A      │
│              │  RESEARCHER             │                     │
│              └─────────────────────────┘                     │
│                         │                                    │
│                         ▼                                    │
│              Outputs:                                        │
│              • Prioritized recommendations                   │
│              • Multi-level roadmap                           │
│              • Markdown report                               │
└──────────────────────────────────────────────────────────────┘
```

### Why Hybrid (D) is Best

1. **Parallel loading** - saves time on I/O
2. **Sequential phases** - maintains clarity
3. **Optional Q&A** - only when needed (saves tokens)
4. **Shared context** - no information loss
5. **Manageable complexity** - not full mesh communication

### Implementation: 12-15 hours
- Faster than full C (17-20)
- More capable than A (5-6)
- Production-ready

---

## Next Steps

1. **Confirm architecture choice** (A, B, C, or D)
2. **Design SharedContextStore** schema
3. **Define Q&A protocol** (if C or D)
4. **Create implementation plan**

Which variant do you want to implement?
