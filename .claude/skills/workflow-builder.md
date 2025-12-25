# n8n Workflow Builder Skill

Auto-start агентская система для создания n8n workflows.

## Activation

**Auto-activate when:**
- User mentions: workflow, воркфлоу, n8n, telegram bot, automation, webhook
- User asks: "создай", "сделай бота", "нужен workflow"
- User continues: "продолжи", "доработай", "исправь"

## Behavior

**1. Check Sessions**
```bash
ls -lt sessions/*.json 2>/dev/null | grep -v archives | head -3
```

**2. Present Options**

Active session exists:
```
🔄 Активная сессия: <sessionId>
   Стадия: <stage> | Цикл: <cycle>

Выбери:
A) Продолжить работу
B) Новый workflow
```

No active sessions:
```
🆕 Создать новый workflow
Опиши задачу (например: "Telegram bot с OpenAI для ответов на вопросы")
```

**3. Execute**

Load SessionManager and start orchestrator:
```typescript
import { sessionManager } from './src/orchestrator/session-manager.js';
import { orchestrator } from './src/orchestrator/index.js';

// Resume or create
const session = await sessionManager.loadSession(id) || await sessionManager.createSession();

// Start workflow building
const result = await orchestrator.start(task, session.id);
```

**4. Progress Display**

Show concise progress:
```
Session: session_abc123 (cycle 1, blueprint)

→ Architect
  ✓ Извлечены опции (A, B, C)
  ✓ User выбрал: A
  ✓ Blueprint: 5 nodes

→ Researcher
  ✓ Найдены templates: 2
  ✓ Node essentials загружены

→ Builder
  ✓ workflow.json создан (412 строк)

→ QA
  ⚠ Phase 5 errors: credential "telegramApi" not found
  → Cycle 2...
```

**5. Error Handling**

If errors after 7 cycles:
```
⚠ 7 циклов завершено, ошибки не устранены

→ Analyst
  📊 Post-mortem анализ...
  🔍 Root cause: ...
  💡 Рекомендации: ...
```

## Commands Reference

```bash
# Resume session
npm start -- --session <sessionId>

# New workflow
npm start -- "Create Telegram bot with AI"

# Interactive mode
npm run interactive
```

## Do NOT

- Explain architecture details unless asked
- Show verbose agent prompts
- Repeat "I will now start..." phrases
- Ask obvious questions

## DO

- Auto-detect intent from user message
- Check sessions proactively
- Show concise progress
- Let agents work autonomously
- Only ask when truly ambiguous

## Session Context

**Files:**
- `sessions/*.json` - active sessions
- `sessions/archives/*_complete.json` - completed

**Session Data:**
```typescript
{
  id: string,
  stage: 'clarification' | 'blueprint' | 'building' | 'testing' | 'complete',
  cycle: number,
  workflowId?: string,
  history: ConversationEntry[],
  fixAttempts: FixAttempt[],
  mcpCalls: MCPCall[]
}
```

**Load session:**
```typescript
const session = await sessionManager.loadSession(sessionId);
console.log(`Cycle: ${session.cycle}, Stage: ${session.stage}`);
```

## Examples

**Example 1: New Workflow**
```
User: "Создай Telegram бота"