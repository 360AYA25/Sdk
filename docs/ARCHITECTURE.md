# SDK Architecture

## Overview

ClaudeN8N SDK uses the Anthropic Claude Agent SDK for native agent orchestration with:
- Persistent session context (200K tokens)
- Native MCP tool integration
- Type-safe TypeScript implementation
- Full conversation history preservation

## Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ SessionManager          │ GateEnforcer                  ││
│  │ - 200K token history    │ - GATE 1: Escalation          ││
│  │ - Fix attempts tracking │ - GATE 2: Exec analysis       ││
│  │ - MCP call logging      │ - GATE 3: Phase 5 testing     ││
│  │ - Agent results store   │ - GATE 4: Already tried       ││
│  │                         │ - GATE 5: MCP verification    ││
│  │                         │ - GATE 6: Hypothesis valid    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Architect   │  │  Researcher  │  │   Builder    │
    │  (Sonnet)    │  │  (Sonnet)    │  │  (Opus 4.5)  │
    │              │  │              │  │              │
    │  NO MCP      │  │  Read/Search │  │  Full MCP    │
    │  WebSearch   │  │  Execution   │  │  Mutations   │
    └──────────────┘  └──────────────┘  └──────────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                    ┌──────────────┐
                    │      QA      │
                    │  (Sonnet)    │
                    │              │
                    │  Validate    │
                    │  Test        │
                    └──────────────┘
                              │
                              ▼ (if blocked)
                    ┌──────────────┐
                    │   Analyst    │
                    │  (Sonnet)    │
                    │              │
                    │  Post-mortem │
                    │  Read-only   │
                    └──────────────┘
```

## Data Flow

### Session Context
```typescript
interface SessionContext {
  id: string;                          // Unique session ID
  workflowId?: string;                 // Target n8n workflow
  stage: Stage;                        // Current stage
  cycle: number;                       // QA cycle count
  history: ConversationEntry[];        // Full conversation (200K)
  fixAttempts: FixAttempt[];          // For GATE 4
  mcpCalls: MCPCall[];                // For GATE 5
  agentResults: Map<AgentRole, Result>;// Agent outputs
}
```

### Stage Transitions
```
clarification → research → decision → credentials → implementation → build → validate → test → complete
                                                                                  ↓
                                                                               blocked → analyst
```

### QA Loop (Progressive Escalation)
```
Cycle 1-3: Builder direct fix
Cycle 4-5: Researcher alternative → Builder
Cycle 6-7: Researcher deep dive → Builder
Cycle 8+:  BLOCKED → Analyst post-mortem
```

## Key Differences from Task() System

| Aspect | Task() Workaround | SDK Implementation |
|--------|-------------------|-------------------|
| Context | 10-entry limit | 200K tokens |
| MCP Tools | Via general-purpose | Native per agent |
| State | File-based run_state | SDK SessionManager |
| History | Lost between cycles | Full preservation |
| Gates | Manual checks | Automatic enforcement |

## File Structure

```
sdk-migration/
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # Type definitions
│   ├── orchestrator/
│   │   ├── index.ts          # Main orchestrator
│   │   ├── session-manager.ts # Session persistence
│   │   └── gate-enforcer.ts  # Validation gates
│   ├── agents/
│   │   ├── base-agent.ts     # Base class
│   │   ├── architect.ts
│   │   ├── researcher.ts
│   │   ├── builder.ts
│   │   ├── qa.ts
│   │   └── analyst.ts
│   └── shared/
│       └── prompts/          # Agent instructions
├── config/
│   ├── agents.json           # Agent configurations
│   ├── gates.json            # Gate rules
│   └── mcp-servers.json      # MCP configuration
└── sessions/                 # Persisted sessions
```

## Validation Gates

| Gate | Enforcement | Location |
|------|-------------|----------|
| GATE 1 | Cycle progression | `orchestrator/index.ts` |
| GATE 2 | Execution analysis | `gate-enforcer.ts` |
| GATE 3 | Phase 5 testing | `gate-enforcer.ts` |
| GATE 4 | Already tried | `session-manager.ts` |
| GATE 5 | MCP calls | `gate-enforcer.ts` |
| GATE 6 | Hypothesis | `gate-enforcer.ts` |

## Extension Points

### Adding New Agents
1. Create class extending `BaseAgent`
2. Add config to `agents.json`
3. Add prompt to `src/shared/prompts/`
4. Register in orchestrator

### Adding New Gates
1. Add to `gates.json`
2. Implement check in `GateEnforcer`
3. Call from orchestrator at appropriate point
