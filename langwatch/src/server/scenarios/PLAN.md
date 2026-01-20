# Scenario OTEL Isolation - Implementation Plan

## Problem
When scenarios run on server via `SimulationRunnerService`, OTEL traces get mixed with server telemetry. Also: zero concurrency control.

## Solution
BullMQ queue/processor in a **separate process** with its own OTEL instrumentation.

---

## Architecture Decision

**OTEL Isolation via Separate Process (not worker_threads)**

Looking at `src/server/background/worker.ts`:
- Line 22: `import "../../instrumentation.node"` - all workers share OTEL context
- All BullMQ workers run in same process

**Solution**: Create a separate entry point `src/scenario-worker.ts` that:
- Has its **own** OTEL instrumentation (scenario-specific, exports to LangWatch)
- Starts a BullMQ worker for scenario jobs
- Runs as a **separate process**

This provides process-level OTEL isolation without needing worker_threads.

---

## What's Salvageable

| File | Status | Action |
|------|--------|--------|
| `adapters/auth-strategies.ts` | ✓ Good | Rename to `adapters/auth.strategies.ts` |
| `worker/model-factory.ts` | ✓ Good | Move to `execution/model.factory.ts` |
| `worker/standalone-adapters.ts` | ✓ Good | Move to `execution/serialized.adapters.ts` |
| `worker/types.ts` | ✓ Good | Move to `execution/types.ts` |

## What Needs to Be Deleted

| File | Reason |
|------|--------|
| `worker/scenario-worker-manager.ts` | "Manager" smell, wrong pattern |
| `worker/scenario-worker.ts` | Raw worker_thread, no BullMQ |
| `worker/index.ts` | Barrel for deleted files |

## New Structure

```
src/
├── scenario-worker.ts              # NEW: Separate entry point with own OTEL
└── server/scenarios/
    ├── scenario.service.ts         # (existing)
    ├── scenario.repository.ts      # (existing)
    ├── scenario.queue.ts           # NEW: Queue + scheduleScenarioRun
    ├── scenario.processor.ts       # NEW: Job processing logic
    ├── simulation-runner.service.ts # UPDATE: Uses queue
    ├── adapters/
    │   ├── auth.strategies.ts      # RENAME
    │   ├── http-agent.adapter.ts   # (existing)
    │   └── prompt-config.adapter.ts # (existing)
    └── execution/                  # Isolated execution context
        ├── model.factory.ts        # MOVE
        ├── serialized.adapters.ts  # MOVE + RENAME
        ├── types.ts                # MOVE
        └── instrumentation.ts      # NEW: Scenario-specific OTEL setup
```

## Implementation Steps

### Phase 1: Restructure Files
1. Rename `adapters/auth-strategies.ts` → `adapters/auth.strategies.ts`
2. Create `execution/` directory
3. Move `worker/model-factory.ts` → `execution/model.factory.ts`
4. Move `worker/standalone-adapters.ts` → `execution/serialized.adapters.ts`
5. Move `worker/types.ts` → `execution/types.ts`
6. Delete `worker/` directory
7. Update imports in dependent files

### Phase 2: Create Queue Infrastructure
1. Create `scenario.queue.ts`:
   - `SCENARIO_QUEUE_NAME = "{scenarios}"`
   - `scenarioQueue` using `QueueWithFallback`
   - `scheduleScenarioRun(params)` helper
   - Job options: backoff (exponential), attempts (3), removeOnComplete/Fail

### Phase 3: Create Processor
1. Create `scenario.processor.ts`:
   - `processScenarioJob(job)` - main processing logic
   - `startScenarioProcessor()` - creates BullMQ Worker
   - Uses serialized adapters from `execution/`

2. Create `execution/instrumentation.ts`:
   - Scenario-specific OTEL setup
   - Exports to LangWatch with scenario metadata (scenarioId, batchRunId)

### Phase 4: Create Separate Entry Point
1. Create `src/scenario-worker.ts`:
   - Imports `execution/instrumentation.ts` (NOT `instrumentation.node.ts`)
   - Calls `startScenarioProcessor()`
   - Run as separate process

### Phase 5: Update SimulationRunnerService
1. Change `execute()` to call `scheduleScenarioRun()`
2. Remove direct execution logic

### Phase 6: Update Tests
1. Rename test files to match new file names
2. Update imports
3. Integration test should work with queue (mock or real)

---

## Naming Conventions

- Files: `thing.type.ts` (e.g., `scenario.queue.ts`, `model.factory.ts`, `auth.strategies.ts`)
- No "Manager" classes (smell)
- No "Standalone" - use "Serialized" (describes the constraint: works with serialized data)
- "Processor" for job processing logic (not "Worker" - that's BullMQ's term)
