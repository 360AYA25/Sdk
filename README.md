# ClaudeN8N SDK

5-Agent n8n Workflow Builder на Claude Agent SDK

**Status:** ✅ 43/43 tests | Build OK | TS 0 errors

## Quick Start

```bash
npm install
cp .env.example .env  # Add ANTHROPIC_API_KEY
npm start -- "Create Telegram bot"
```

## Usage

```bash
npm start -- "Create workflow"       # Basic
INTERACTIVE_MODE=true npm start      # Interactive
npm test                            # Tests
```

## Architecture

```
User → Orchestrator → 5 Agents → 6 Gates → QA → Done
```

**Agents:**
- Architect (Sonnet) - дизайн
- Researcher (Sonnet) - поиск
- Builder (Opus) - создание
- QA (Sonnet) - валидация
- Analyst (Sonnet) - post-mortem

**Gates:** Progressive escalation, Blueprint check, Phase 5 testing, ALREADY_TRIED, MCP verify, Hypothesis

## Structure

```
src/
├── agents/          # 5 agents
├── orchestrator/    # routing + gates
└── shared/prompts/  # инструкции

tests/               # 43 tests
config/              # конфиги
docs/                # ARCHITECTURE.md
```

## Docs

- [CHANGELOG.md](./CHANGELOG.md) - история v1.0.0
- [CHECKLIST.md](./CHECKLIST.md) - verification
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - архитектура

## Scripts

```bash
npm start              # run
npm run interactive    # user prompts
npm test              # all tests
npm run build         # compile
npm run typecheck     # check types
```
