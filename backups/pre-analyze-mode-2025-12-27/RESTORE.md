# Restore Instructions

**Checkpoint:** pre-analyze-mode
**Date:** 2025-12-27
**Git Tag:** `checkpoint-pre-analyze-mode`

## What's Backed Up

```
backups/pre-analyze-mode-2025-12-27/
├── agents/              # All 5 agents
│   ├── architect.ts
│   ├── analyst.ts
│   ├── base-agent.ts
│   ├── builder.ts
│   ├── qa.ts
│   └── researcher.ts
├── orchestrator/        # Orchestrator + helpers
│   ├── gate-enforcer.ts
│   ├── index.ts
│   ├── session-manager.ts
│   └── user-interface.ts
├── shared/              # Shared prompts
│   └── prompts/
├── index.ts             # Entry point
├── types.ts             # Type definitions
├── package.json         # Dependencies
└── tsconfig.json        # TS config
```

## How to Restore

### Option 1: Git Tag (Recommended)

```bash
# Reset to checkpoint
git checkout checkpoint-pre-analyze-mode

# Or create branch from checkpoint
git checkout -b restore-from-checkpoint checkpoint-pre-analyze-mode
```

### Option 2: Manual File Restore

```bash
# Restore agents
cp -r backups/pre-analyze-mode-2025-12-27/agents/* src/agents/

# Restore orchestrator
cp -r backups/pre-analyze-mode-2025-12-27/orchestrator/* src/orchestrator/

# Restore core files
cp backups/pre-analyze-mode-2025-12-27/types.ts src/
cp backups/pre-analyze-mode-2025-12-27/index.ts src/

# Rebuild
npm run rebuild
npm test
```

### Option 3: Git Reset (Nuclear)

```bash
# Hard reset to tag (LOSES ALL CHANGES!)
git reset --hard checkpoint-pre-analyze-mode
```

## SDK State at Checkpoint

- **Version:** v1.0.2
- **Tests:** 43/43 passing
- **CREATE Mode:** Fully working
- **ANALYZE Mode:** Not implemented yet

## Why This Checkpoint Exists

Before implementing Context-First Analyzer (Variant C):
- Adding SharedContextStore
- Adding Inter-agent Q&A protocol
- Adding Analyzer orchestrator
- Modifying agents with setMode()

This checkpoint ensures we can rollback if implementation breaks CREATE mode.
