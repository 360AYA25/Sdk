# ClaudeN8N SDK Project

5-Agent n8n Workflow Builder on Claude Agent SDK.

## Writing Rules (ОБЯЗАТЕЛЬНО!)

**Language:**
- ALL prompts, code comments, agent instructions → ENGLISH ONLY
- User communication → Russian OK

**Prompt Style:**
- MAX 10 lines per agent prompt
- NO philosophy, NO explanations
- Format: `## TASK` → `## RULES` → `## OUTPUT`
- Example:
  ```
  ## TASK
  Find bugs in workflow.

  ## RULES
  - Call validate_workflow
  - List errors with node names

  ## OUTPUT
  JSON array of issues
  ```

**Code Style:**
- Comments: 1 line max
- Function names: self-documenting
- No redundant logging

## Architecture

```
User → Orchestrator → Architect → Researcher → Builder → QA → Analyst
                    ↓
                 6 Gates (GATE 1-6)
                    ↓
              SessionManager (200K tokens)
```

**Agents:**
- Architect (Sonnet) - blueprint design, option extraction
- Researcher (Sonnet) - template search, node lookup via MCP
- Builder (Opus 4.5) - workflow JSON creation
- QA (Sonnet) - Phase 5 validation, error detection
- Analyst (Sonnet) - post-mortem after 7 cycles

**Gates:**
- GATE 1: Progressive escalation (cycle ≤7)
- GATE 2: Blueprint completeness check
- GATE 3: Phase 5 testing enforcement
- GATE 4: ALREADY_TRIED pattern detection
- GATE 5: MCP verify before builder
- GATE 6: Hypothesis validation

**Flow:**
1. Architect extracts options → user selects → creates blueprint
2. Researcher finds templates if nodeCount ≥5
3. Builder creates workflow JSON
4. QA validates (Phase 5 = execute + test)
5. If errors: cycle 1-3 Builder, 4-5 Researcher, 6-7 Deep dive, 8+ Analyst

## SDK Agent System (ALWAYS USE)

**CRITICAL:** Для ЛЮБЫХ задач с n8n workflows используй SDK агентов, НЕ делай вручную!

### Когда запускать SDK:

| Задача | Команда |
|--------|---------|
| Создать workflow | `npm start -- "описание"` |
| Анализ workflow | `npm run analyze -- <workflowId>` |
| Анализ + авто-фикс | `npm run analyze -- <workflowId>` → выбрать `[A]` |
| Dev режим | `npm run dev -- "описание"` |

### Auto-Fix Flow:

После анализа, если найдены баги:
```
npm run analyze -- sw3Qs3Fe3JahEbbW
# Анализ завершён, показывает меню:
# [A] Apply fixes automatically ← ВЫБРАТЬ ЭТО
# Запускает ПОЛНУЮ 5-агентную систему:
# Architect → Researcher → Builder → QA → Analyst
# Все 6 gates активны (как при CREATE mode)
```

### Детекция Intent:

Автоматически запускай SDK при словах:
- "создай workflow", "сделай бота", "нужен воркфлоу"
- "проанализируй", "найди баги", "что не так с workflow"
- "исправь", "пофикси", "доработай workflow"
- Любой workflowId (формат: `[a-zA-Z0-9]{16}`)

### Пример:

```
User: "Проанализируй workflow sw3Qs3Fe3JahEbbW и исправь баги"

Claude:
1. npm run analyze -- sw3Qs3Fe3JahEbbW
2. После анализа выбирает [A] Auto-fix
3. Builder применяет фиксы
4. Показывает результат
```

**НИКОГДА:**
- Не редактируй workflow JSON вручную
- Не пиши код для n8n без SDK
- Не анализируй workflow глазами (используй Researcher agent)

---

## Workflow Mode (Auto-Start)

**IMPORTANT:** When user opens this project, automatically activate workflow mode:

**Step 1: Check Active Sessions**
```bash
ls -lt sessions/*.json 2>/dev/null | grep -v archives | head -5
```

**Step 2: Auto-Resume or Create New**

If active session found:
```
"Обнаружена активная сессия <sessionId> (цикл X, стадия Y).
Продолжить работу или создать новый workflow?"

Options:
A) Продолжить (resume session)
B) Новый workflow (create new)
```

If no active sessions:
```
"Создать новый n8n workflow.
Опиши что нужно сделать (например: 'Telegram bot с AI', 'HTTP API для базы данных')"
```

**Step 3: Auto-Execute**

After user responds, immediately:
1. Load or create session via SessionManager
2. Start orchestrator with task
3. No additional explanations needed
4. Show only agent progress and results

**Commands:**
```bash
# Resume existing
npm start -- --session <sessionId>

# Create new
npm start -- "Create workflow: <description>"

# Interactive (auto-detects sessions)
npm run interactive
```

**User Intent Detection:**

When user writes workflow-related request, auto-activate:
- "создай workflow...", "сделай бота...", "нужен воркфлоу..."
- "продолжи", "доработай", "исправь ошибки"
- Any n8n/workflow/automation keywords

**What to Show:**
```
✓ Session: session_xyz (cycle 2, building)
✓ Architect: 3 опции извлечены
✓ User selected: Option A
✓ Blueprint: 7 nodes (Webhook → Code → Telegram)
✓ Builder: workflow.json создан
✓ QA: Phase 5 - executing...
  ⚠ Errors found: credential missing
✓ Cycle 2: Builder fixing...
```

**What NOT to Show:**
- Long explanations of architecture
- "Я сейчас запущу...", "Давайте начнем..."
- Technical details unless asked
- Philosophy about agents

**Session Files:**
- Active: `sessions/*.json`
- Archived: `sessions/archives/*_complete.json`
- Auto-persist after each agent

## Code Rules

**TypeScript:**
- Strict mode, no `any`, explicit types
- Import with `.js` extension (ESM)
- Types in `src/types.ts` or agent files
- Use Zod for runtime validation

**Agents (`src/agents/`):**
- Max 400 lines per agent
- Reference `src/shared/prompts/` for instructions
- Return structured results (Zod schemas)
- No direct MCP calls (use orchestrator)

**Orchestrator (`src/orchestrator/`):**
- `index.ts` - main routing logic
- `gate-enforcer.ts` - validation gates
- `session-manager.ts` - history + context
- `user-interface.ts` - interactive mode

**SessionManager:**
- Stores full conversation (200K token context)
- Auto-persist to `./sessions/*.json`
- Track: cycle, fixAttempts, mcpCalls, hypotheses

**Prompts (`src/shared/prompts/`):**
- One file per agent: `architect.md`, `researcher.md`, etc.
- Reference in agent code: `readFileSync('src/shared/prompts/architect.md')`
- Max 400 lines, no philosophy

## Testing

**Structure:**
```
tests/
├── unit/
│   ├── session-manager.test.ts  (17 tests)
│   └── gate-enforcer.test.ts    (22 tests)
└── integration/
    └── workflow.test.ts         (4 tests)
```

**Commands:**
```bash
npm test              # all 43 tests
npm run test:unit     # unit only
npm run test:watch    # watch mode
npm run test:run      # vitest run
```

**Writing Tests:**
- Use Vitest, vi.mock() for externals
- Test SessionManager: persistence, history, gate counters
- Test GateEnforcer: all 6 gates, edge cases
- Integration: manual scenarios in test output

**Coverage Target:** Core logic (orchestrator, gates) must be tested

## Patterns

**Agent Invocation:**
```ts
const result = await agent.run(context, input);
// result validated with Zod schema
```

**Gate Enforcement:**
```ts
await gateEnforcer.enforceGate(gateNumber, session, data);
// throws if validation fails
```

**Session Update:**
```ts
sessionManager.updateSession(sessionId, {
  cycle: session.cycle + 1,
  fixAttempts: session.fixAttempts + 1
});
```

**Interactive Mode:**
```ts
if (process.env.INTERACTIVE_MODE === 'true') {
  const choice = await ui.selectOption(options);
  const confirmed = await ui.confirmBlueprint(blueprint);
}
```

## Before Commit

**Checklist:**
```bash
npm run typecheck   # 0 errors
npm run build       # success
npm test           # 43/43 pass
```

**Never commit:**
- Secrets in code
- `.env` file (use `.env.example`)
- `dist/` directory
- `node_modules/`

## Key Files

**Entry:** `src/index.ts` - loads env, starts orchestrator
**Types:** `src/types.ts` - shared interfaces
**Config:** `config/agent-config.ts` - model selection
**Env:** `.env.example` - all variables template

## Common Tasks

**Add new gate:**
1. Add to `GateEnforcer.enforceGate()` switch
2. Add tests in `tests/unit/gate-enforcer.test.ts`
3. Update docs in `src/shared/prompts/gates.md`

**Add new agent:**
1. Create `src/agents/new-agent.ts`
2. Create prompt `src/shared/prompts/new-agent.md`
3. Add to orchestrator routing
4. Add tests

**Debug session:**
```bash
cat sessions/<sessionId>.json | jq '.history[-5:]'  # last 5 messages
```

**Interactive mode:**
```bash
npm run interactive
# or
INTERACTIVE_MODE=true npm start -- "Create workflow"
```

## MCP Tools (n8n-mcp)

**Available:**
- `get_node_essentials` - node info for builder
- `search_nodes` - find nodes by keyword
- `get_templates` - workflow templates
- `validate_workflow` - check JSON
- `execute_workflow` - Phase 5 testing

**Usage Pattern:**
```ts
// In Researcher/Builder via orchestrator
const mcpResult = await mcp.callTool('get_node_essentials', { nodeType: 'n8n-nodes-base.telegram' });
```

## Telegram Bot Testing (ОБЯЗАТЕЛЬНО!)

**CRITICAL:** Когда нужно протестировать workflow с Telegram ботом — используй ТОЛЬКО Telethon API!

**Полный гайд:** `/Users/sergey/Projects/n8n-docs/bot-testing-system/TESTING_GUIDE.md`

### Краткий процесс:

```bash
# 1. Health check
curl -s 'http://72.60.28.252:5001/health'

# 2. Отправить сообщение боту
curl -s -X POST 'http://72.60.28.252:5001/send_telegram' \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"@Multi_Bot0101_bot","message":"/day"}'
# → Сохрани message_id!

# 3. Дождаться ответа бота
curl -s -X POST 'http://72.60.28.252:5001/wait_for_response' \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"@Multi_Bot0101_bot","after_message_id":12345,"timeout":25}'
```

### НИКОГДА:
- Не симулируй ответы бота
- Не пропускай wait_for_response
- Не отправляй несколько сообщений параллельно

### Bot IDs:
- `@Multi_Bot0101_bot` (ID: 7845235205) — Food Tracker
- User ID: 682776858 (seno1885)

**Если sender_id = 682776858 → это твоё сообщение, бот ещё не ответил!**

---

## Decisions Log

**Why Opus for Builder?**
- Best code generation quality
- Critical for workflow JSON correctness

**Why 200K token context?**
- Full conversation history vs Task() 10 entries
- Better error pattern detection

**Why 7 cycle limit?**
- Prevents infinite loops
- Forces escalation to Analyst

**Why Phase 5 testing?**
- Execution validates integration
- Catches runtime errors early

## Anti-Patterns

**DON'T:**
- Skip gates (they prevent bad outputs)
- Hardcode workflow JSON (use builder)
- Mock MCP in integration tests (use real n8n)
- Create new files for one-time logic
- Add verbose documentation

**DO:**
- Use SessionManager for all state
- Enforce gates strictly
- Test error scenarios
- Keep agents focused (single responsibility)
- Reference existing prompts
