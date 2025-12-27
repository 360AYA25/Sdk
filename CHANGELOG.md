# Changelog

All notable changes to the ClaudeN8N SDK project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2025-12-27

### ✨ New Feature: Context-First Workflow Analyzer

A new ANALYZE mode for deep workflow analysis with inter-agent communication.

### Added

**Analyze Mode Infrastructure**
- `SharedContextStore` - Central data store with write permissions per agent
- `MessageCoordinator` - Inter-agent Q&A protocol for clarification
- `AnalyzerOrchestrator` - 4-phase analysis flow (Load → Understand → Investigate → Synthesize)

**Agent Extensions**
- `setMode('analyze')` for Architect, Researcher, Analyst agents
- Separate prompt files for analyze mode (`*-analyze.md`)
- Mode-specific MCP tool configurations

**New Files**
- `src/shared/context-store.ts` - SharedContextStore implementation
- `src/shared/message-protocol.ts` - MessageCoordinator for Q&A
- `src/orchestrators/analyze/index.ts` - Analyzer orchestrator
- `src/shared/prompts/architect-analyze.md` - Architect analysis prompt
- `src/shared/prompts/researcher-analyze.md` - Researcher audit prompt
- `src/shared/prompts/analyst-analyze.md` - Analyst synthesis prompt

**New Types** (~300 lines in `src/types.ts`)
- `SharedContext`, `ArchitectAnalysis`, `ResearcherAnalysisFindings`
- `AnalysisReport`, `ReportFinding`, `Recommendation`, `RoadmapItem`
- `AgentMessage`, `MessageType`, `MessagePriority`, `QAExchange`

**New Commands**
```bash
npm run analyze -- <workflowId>
npm run analyze -- <workflowId> <projectPath>
npm run dev:analyze -- <workflowId>
```

### Analysis Flow

```
Phase 0: Load Context (parallel)
  ├── Project docs (README, TODO, PLAN)
  ├── Workflow data via MCP
  └── Execution history

Phase 1: Architect Understanding
  └── Business context, service architecture, data flow, gaps

Phase 2: Researcher Investigation
  ├── Node-by-node audit
  ├── Connection analysis
  ├── Execution patterns
  └── Q&A with Architect if needed

Phase 3: Analyst Synthesis
  ├── Cross-reference findings
  ├── Prioritize issues (P0-P3)
  ├── Generate recommendations
  └── Create roadmap

Phase 4: Report Generation
  ├── Markdown report (reports/ANALYSIS-xxx.md)
  └── JSON report (reports/ANALYSIS-xxx.json)
```

### Output Example

```
✅ Analysis complete!
Report: reports/ANALYSIS-sw3Qs3Fe3JahEbbW-2025-12-27.md
Summary:
  • Overall health: needs_attention
  • Critical issues: 1
  • Total issues: 5
  • Recommendations: 4
  • Q&A exchanges: 2
```

### Technical Details

- CREATE mode unchanged in `src/orchestrator/`
- Agents switch modes via `setMode()` method
- Automatic mode reset to 'create' after analysis
- Reports saved to `reports/` directory
- Sessions saved to `sessions/analyze/`

### Compatibility

- ✅ All 43 existing tests pass
- ✅ TypeScript compilation: 0 errors
- ✅ CREATE mode fully backward compatible

---

## [1.0.2] - 2025-12-27 ⭐ **STABLE**

> **🏆 Most Stable Release** - Production-ready with critical Agent SDK hang fix

### 🚨 Critical Fixes

**Agent SDK Timeout Protection**
- Fixed infinite hangs on 3+ consecutive `query()` invokes
- Added Promise.race() timeout wrapper in `base-agent.ts`
- Dynamic timeouts based on workflow complexity:
  - Base: 90 seconds (simple workflows)
  - Extended: 180 seconds (nodeCount >= 10)
- Graceful fallback for `validateHypothesis()` timeout

**Claude Code Authentication**
- Support for Claude Code built-in authentication
- `ANTHROPIC_API_KEY` now optional in `.env`
- Automatic detection and logging of auth method

### ✅ Validation

**Production Testing**
- ✅ 3-node webhook workflow: 4.5 min, 29 MCP calls
- ✅ 20-node Telegram AI bot: 10 min, 72 MCP calls
  - Components: Telegram + OpenAI GPT-4 + LangChain + Postgres + Slack
  - Error handling + monitoring included
- ✅ 100% success rate, zero hangs

**Test Coverage**
- All 43 tests passing (17 SessionManager + 22 GateEnforcer + 4 integration)
- TypeScript compilation: 0 errors
- Full validation quality maintained

### 📊 Performance Metrics

| Metric | Simple (3 nodes) | Complex (20 nodes) |
|--------|-----------------|-------------------|
| **Time** | ~4.5 min | ~10 min |
| **MCP Calls** | 29 | 72 |
| **Calls/Node** | 9.7 | 3.6 |
| **Timeout** | 90s | 180s |
| **Success Rate** | 100% | 100% |

### 🔧 Technical Details

**Files Changed**
- `src/agents/base-agent.ts`: Timeout wrapper implementation
- `src/orchestrator/index.ts`: Graceful validateHypothesis handling
- `src/index.ts`: Optional ANTHROPIC_API_KEY validation
- `.env`: Claude Code authentication mode

**Commit**
- `7f858b1` - "fix: add timeout wrapper to prevent Agent SDK hangs"

### 🎯 Recommendations

- **Production use**: This version is recommended for all production deployments
- **Complex workflows**: Tested and validated with 20+ node enterprise workflows
- **Authentication**: Use Claude Code built-in auth (leave ANTHROPIC_API_KEY empty)

---

## [1.0.1] - 2025-12-25

### 🐛 Bugfixes

- Fixed `TypeError: report.proposed_learnings is not iterable` in orchestrator
- Fixed `TypeError: report.timeline is not iterable` in analyst
- Added null checks: `|| []` and `|| {}`

---

## [1.0.0] - 2025-12-25

### ✨ Initial Release

The ClaudeN8N SDK is a complete migration from the Task() workaround system to native Claude Agent SDK implementation.

### Added

#### Core Architecture
- **5-Agent System**: Architect, Researcher, Builder (Opus 4.5), QA, Analyst
- **Orchestrator**: Central routing with state machine (9 stages)
- **SessionManager**: Persistent 200K token context (vs 10 entries before)
- **GateEnforcer**: 6 validation gates for quality control
- **Interactive Mode**: User confirmations for options and blueprints

#### Agents

**Architect Agent**
- Clarification dialog with explicit requirement extraction
- Options presentation (A/B/C) with fit scores
- Blueprint creation with node count validation (GATE 2)
- Credential selection workflow
- NO MCP tools (design-only agent)

**Researcher Agent**
- L-066: 5-Tier Search Hierarchy (LEARNINGS → workflows → templates → nodes → web)
- L-067: Two-step execution analysis (summary + filtered modes)
- Hypothesis validation (GATE 6)
- Alternative approach search (cycles 4-5)
- Deep dive analysis (cycles 6-7)
- Credential discovery

**Builder Agent**
- L-075: Anti-hallucination protocol (MCP calls required)
- L-079: Post-build verification
- Surgical edits with edit_scope enforcement
- Snapshot before destructive changes
- Wipe protection (>50% nodes = STOP)
- MCP calls logging (GATE 5)
- Opus 4.5 model for maximum capability

**QA Agent**
- 5-Phase validation (Structure → Config → Logic → Special → Testing)
- GATE 3: Phase 5 Real Testing (MANDATORY!)
- L-072: Verify via MCP (not files)
- False positive filtering (L-053, L-054)
- edit_scope generation for Builder
- Regression detection
- Test execution tracking

**Analyst Agent**
- Post-mortem analysis (L4 escalation only)
- Timeline reconstruction
- Agent grading (1-10 scale)
- Token usage tracking
- Learning extraction (L-XXX format)
- Writes to LEARNINGS.md and SYSTEM-CONTEXT.md

#### Validation Gates

- **GATE 1**: Progressive escalation (L1: cycles 1-3, L2: 4-5, L3: 6-7, L4: 8+)
- **GATE 2**: Blueprint validation (structure, node count, credentials)
- **GATE 3**: Phase 5 real testing enforcement
- **GATE 4**: ALREADY_TRIED automatic injection to Builder
- **GATE 5**: MCP mutation calls verification
- **GATE 6**: Hypothesis validation before proposal

#### Session Management

- 200K token conversation history
- Persistent session storage (./sessions/)
- Fix attempts tracking
- MCP call logging
- Agent results caching
- Session archival on completion
- Stage/cycle management

#### Developer Features

- **TypeScript**: Full type safety with 0 compilation errors
- **Testing**: 43 unit + integration tests (100% passing)
- **Interactive Mode**: User confirmations via CLI prompts
- **Retry Logic**: Exponential backoff for MCP failures
- **Error Handling**: Graceful degradation
- **Documentation**: Comprehensive README + CHECKLIST

#### Skills System

- `n8n-workflow-patterns`: Proven workflow architectures
- `n8n-node-configuration`: Operation-aware node setup
- `n8n-code-javascript`: JavaScript in Code nodes
- `n8n-code-python`: Python in Code nodes
- `n8n-expression-syntax`: Expression validation and fixes
- `n8n-validation-expert`: Error interpretation
- `n8n-mcp-tools-expert`: MCP tool usage guidance

#### Indexes (97% Token Savings)

- `architect_patterns.md`: Workflow design patterns
- `researcher_nodes.md`: n8n node catalog
- `builder_gotchas.md`: Common pitfalls and solutions
- `qa_validation.md`: Validation rules and false positives
- `analyst_learnings.md`: Historical learnings (L-XXX)

### Technical Improvements

#### vs Task() Workaround System

| Feature | Before (Task) | After (SDK) |
|---------|--------------|-------------|
| **Context** | 10 entries max | 200K tokens |
| **MCP Tools** | Via general-purpose | Native per agent |
| **State** | File-based run_state | SessionManager |
| **History** | Lost between cycles | Full preservation |
| **Gates** | Manual checks | Automatic enforcement |
| **Models** | Same for all | Opus for Builder |
| **Interactive** | No | Yes (INTERACTIVE_MODE) |
| **Retry** | Manual | Automatic exponential backoff |

#### Performance

- Session persistence: < 10ms
- History trimming: Automatic at 200K tokens
- MCP call logging: Async, non-blocking
- Gate enforcement: < 1ms per check
- Test suite: 319ms total

### Testing

- **Unit Tests**: 39 tests
  - SessionManager: 17 tests
  - GateEnforcer: 22 tests
- **Integration Tests**: 4 tests
- **Total**: 43/43 passing (100%)
- **Build**: TypeScript compilation successful
- **Coverage**: Critical components (SessionManager, GateEnforcer)

### Documentation

- README.md: Quick start + usage examples
- CHECKLIST.md: Verification checklist with test results
- ARCHITECTURE.md: System design and data flow
- docs/learning/: Learning repository
- Manual testing guide: 3 test scenarios

### Dependencies

- `@anthropic-ai/claude-agent-sdk`: ^0.1.0
- `dotenv`: ^16.4.7
- `typescript`: ^5.7.2
- `vitest`: ^2.1.9

### Configuration

- `.env.example`: Environment template
- `.mcp.json`: MCP server configuration (symlink supported)
- `config/agents.json`: Agent configurations
- `config/gates.json`: Gate rules
- `tsconfig.json`: TypeScript configuration
- `vitest.config.ts`: Test configuration

---

## [0.9.0] - 2025-12-24

### Migration Preparation

- Initial codebase analysis
- Architecture design
- Type definitions
- Agent scaffolding

---

## Future Roadmap

### [1.1.0] - Planned

- [ ] Legacy `run_state.json` compatibility layer
- [ ] Additional agent unit tests (Architect, Researcher, Builder, QA, Analyst)
- [ ] End-to-end workflow tests with real n8n instance
- [ ] Performance benchmarks
- [ ] Token usage optimization
- [ ] Streaming responses support

### [1.2.0] - Planned

- [ ] Web UI for interactive mode
- [ ] Workflow versioning and rollback
- [ ] Multi-workflow session support
- [ ] Agent performance analytics
- [ ] Custom skill creation guide

### [2.0.0] - Future

- [ ] Plugin system for custom agents
- [ ] Distributed session management
- [ ] Multi-user support
- [ ] Cloud deployment templates

---

## Links

- **Repository**: [GitHub](https://github.com/your-org/clouden8n-sdk)
- **Issues**: [GitHub Issues](https://github.com/your-org/clouden8n-sdk/issues)
- **Changelog**: [CHANGELOG.md](./CHANGELOG.md)
- **License**: MIT
