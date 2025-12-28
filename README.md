# ClaudeN8N SDK

5-Agent n8n Workflow Builder на Claude Agent SDK

**Status:** ✅ 43/43 tests | Build OK | TS 0 errors

## Quick Start

```bash
npm install
cp .env.example .env  # Add ANTHROPIC_API_KEY (optional)
npm run build
```

## Modes

### CREATE Mode (создание workflow)

```bash
# Базовый запуск
npm start -- "Create Telegram bot with AI"

# Интерактивный режим (с подтверждениями)
INTERACTIVE_MODE=true npm start

# Dev режим (без build)
npm run dev -- "Create workflow"
```

### ANALYZE Mode (анализ существующего workflow)

```bash
# Интерактивный анализ (с выбором действий после)
npm run analyze -- sw3Qs3Fe3JahEbbW

# С проектной документацией
npm run analyze -- sw3Qs3Fe3JahEbbW /path/to/project

# Только отчёт (без интерактива)
npm run analyze -- sw3Qs3Fe3JahEbbW --no-interactive

# Dev режим
npm run dev:analyze -- sw3Qs3Fe3JahEbbW
```

**Интерактивный режим - после анализа:**
```
What would you like to do?

[A] Apply fixes automatically (3 priority fixes - Builder agent)
[M] Review and apply manually (show detailed instructions)
[S] Save report and exit
[Q] Quit without saving

Choice [A/M/S/Q]: A
```

**Auto-fix (опция A):**
- Запускает ПОЛНУЮ 5-агентную систему (Architect → Researcher → Builder → QA → Analyst)
- Все 6 валидационных gates активны
- Применяет P0/P1 фиксы через полный orchestrator
- Спрашивает подтверждение перед стартом `[Y/n]`

**Фазы ANALYZE:**
1. Load - загрузка контекста (docs + workflow + executions)
2. Understand - Architect анализирует intent и архитектуру
3. Investigate - Researcher проводит технический аудит
4. Synthesize - Analyst генерирует отчёт с рекомендациями

**Output:** `reports/ANALYSIS-{workflowId}-{date}.md`

## Architecture

```
CREATE:  User → Orchestrator → 5 Agents → 6 Gates → QA → Done
ANALYZE: User → Analyzer → Architect → Researcher → Analyst → Report
```

**Agents:**
- Architect (Sonnet) - дизайн / понимание intent
- Researcher (Sonnet) - поиск / технический аудит
- Builder (Opus) - создание JSON
- QA (Sonnet) - валидация
- Analyst (Sonnet) - post-mortem / синтез отчёта

**Gates:** Progressive escalation, Blueprint check, Phase 5 testing, ALREADY_TRIED, MCP verify, Hypothesis

## Structure

```
src/
├── agents/              # 5 agents (с setMode для analyze)
├── orchestrator/        # CREATE mode routing
├── orchestrators/
│   └── analyze/         # ANALYZE mode orchestrator
└── shared/
    ├── prompts/         # инструкции (+ *-analyze.md)
    ├── context-store.ts # SharedContextStore
    └── message-protocol.ts # Q&A между агентами

tests/                   # 43 tests
config/                  # конфиги
reports/                 # ANALYZE output
```

## Docs

- [CHANGELOG.md](./CHANGELOG.md) - история версий
- [CHECKLIST.md](./CHECKLIST.md) - verification
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - архитектура

## All Scripts

```bash
# CREATE mode
npm start                # production
npm run dev              # development
npm run interactive      # с user prompts

# ANALYZE mode
npm run analyze          # интерактивный (с auto-fix)
npm run analyze -- --no-interactive  # только отчёт
npm run dev:analyze      # development

# Build & Test
npm run build            # compile TS
npm run typecheck        # check types
npm test                 # all 43 tests
npm run test:unit        # unit only
npm run test:watch       # watch mode
```
