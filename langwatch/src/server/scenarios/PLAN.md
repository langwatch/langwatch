# Scenario OTEL Isolation - Refactoring Plan

## Problem
When scenarios run on server via `SimulationRunnerService`, OTEL traces get mixed with server telemetry. Also: zero concurrency control.

## Solution
BullMQ queue/processor in a **separate process** with its own OTEL instrumentation.

---

## Uncle Bob's Review Findings

The initial implementation violated multiple SOLID principles:

| Violation | Issue | Fix |
|-----------|-------|-----|
| **SRP** | `processScenarioJob` is 125-line god function with 6+ responsibilities | Extract into focused classes |
| **DIP** | Direct instantiation of dependencies (prisma, services) | Inject dependencies via interfaces |
| **OCP** | Switch on target type - must modify to add new types | Target adapter factory registry |
| **SRP** | `SimulationRunnerService` is useless pass-through returning misleading `success: true` | Eliminate or make meaningful |
| **ISP** | `ScenarioWorkerData` is bloated interface | Segregate into focused interfaces |
| **Tests** | Mock verification, not behavior testing | TDD with real test doubles |
| **Clean Code** | Magic strings/numbers everywhere | Extract configuration constants |
| **Clean Code** | Silent error swallowing in tracer shutdown | Propagate or handle properly |

---

## Architecture

```text
src/
├── scenario-worker.ts                    # Entry point (separate process)
└── server/scenarios/
    ├── scenario.constants.ts             # Configuration constants
    ├── scenario.queue.ts                 # Queue + scheduleScenarioRun
    ├── scenario.processor.ts             # Thin wrapper, delegates to orchestrator
    │
    ├── execution/
    │   ├── orchestrator.ts               # ScenarioExecutionOrchestrator (SRP)
    │   ├── orchestrator.types.ts         # Interfaces for DIP
    │   ├── instrumentation.ts            # OTEL tracer factory
    │   ├── model.factory.ts              # Vercel AI model creation
    │   ├── serialized.adapters.ts        # Adapters that work with serialized data
    │   └── types.ts                      # Segregated interfaces (ISP)
    │
    ├── adapters/
    │   ├── adapter.factory.ts            # TargetAdapterFactory registry (OCP)
    │   ├── adapter.types.ts              # Adapter interfaces
    │   ├── prompt.adapter.factory.ts     # Creates prompt adapters
    │   ├── http.adapter.factory.ts       # Creates HTTP adapters
    │   ├── auth.strategies.ts            # Auth header strategies
    │   ├── http-agent.adapter.ts         # (existing)
    │   └── prompt-config.adapter.ts      # (existing)
    │
    └── __tests__/
        ├── orchestrator.unit.test.ts     # Unit tests with test doubles
        ├── adapter.factory.unit.test.ts  # Factory registry tests
        ├── scenario.integration.test.ts  # Real integration tests
        └── *.test.ts                     # Other focused tests
```

---

## Refactoring Checklist

### Phase 1: Extract Configuration Constants
- [ ] Create `scenario.constants.ts` with named constants:
  - [ ] `COMPLETED_JOB_RETENTION_SECONDS`
  - [ ] `FAILED_JOB_RETENTION_SECONDS`
  - [ ] `WORKER_CONCURRENCY`
  - [ ] `STALLED_INTERVAL_MS`
  - [ ] `DEFAULT_MODEL`
  - [ ] `DEFAULT_SET_ID`
- [ ] Update `scenario.queue.ts` to use constants
- [ ] Update `scenario.processor.ts` to use constants

### Phase 2: Segregate Interfaces (ISP)
- [ ] Create `execution/types.ts` with segregated interfaces:
  - [ ] `ScenarioConfig` (id, name, situation, criteria)
  - [ ] `ExecutionContext` (setId, batchRunId)
  - [ ] `ModelConfig` (defaultModel, params, nlpServiceUrl)
  - [ ] `TelemetryConfig` (endpoint, apiKey)
- [ ] Update consumers to use only the interfaces they need

### Phase 3: Create Adapter Factory Registry (OCP)
- [ ] Create `adapters/adapter.types.ts`:
  - [ ] `TargetAdapterFactory` interface with `supports(type)` and `create()`
  - [ ] `AdapterResult` type (success/failure union)
- [ ] Create `adapters/prompt.adapter.factory.ts`:
  - [ ] Implements `TargetAdapterFactory`
  - [ ] `supports(type)` returns `type === 'prompt'`
  - [ ] `create()` handles prompt-specific logic
  - [ ] Inject `PromptService` dependency
- [ ] Create `adapters/http.adapter.factory.ts`:
  - [ ] Implements `TargetAdapterFactory`
  - [ ] `supports(type)` returns `type === 'http'`
  - [ ] `create()` handles HTTP-specific logic
  - [ ] Inject `AgentRepository` dependency
- [ ] Create `adapters/adapter.factory.ts`:
  - [ ] `TargetAdapterRegistry` class
  - [ ] Constructor takes array of `TargetAdapterFactory`
  - [ ] `create(target)` finds matching factory and delegates
- [ ] Write unit tests for each factory FIRST (TDD)

### Phase 4: Create Orchestrator with DIP (SRP + DIP)
- [ ] Create `execution/orchestrator.types.ts`:
  - [ ] `ScenarioRepository` interface (getById)
  - [ ] `ProjectRepository` interface (getProject)
  - [ ] `TracerFactory` interface (create, returns handle with shutdown)
  - [ ] `ScenarioExecutor` interface (run)
  - [ ] `OrchestratorDependencies` interface (all deps)
- [ ] Create `execution/orchestrator.ts`:
  - [ ] `ScenarioExecutionOrchestrator` class
  - [ ] Constructor takes `OrchestratorDependencies`
  - [ ] `execute(job)` method - ONLY orchestrates, no direct instantiation
  - [ ] Each step is a single method call to an injected dependency
  - [ ] Proper error handling - no silent swallowing
- [ ] Write unit tests for orchestrator FIRST (TDD):
  - [ ] Test with test doubles (not mocks that verify calls)
  - [ ] Test behavior: "given X, when Y, then Z"
  - [ ] Test error cases return proper failures

### Phase 5: Update Processor to Use Orchestrator
- [ ] Update `scenario.processor.ts`:
  - [ ] `createOrchestrator()` factory function - wires real dependencies
  - [ ] `processScenarioJob(job)` - thin wrapper, delegates to orchestrator
  - [ ] `startScenarioProcessor()` - unchanged (BullMQ worker setup)
- [ ] Delete the god function logic (now in orchestrator + factories)

### Phase 6: Fix or Eliminate SimulationRunnerService
- [ ] Decide: Does this service add value?
  - Option A: Eliminate it - router calls `scheduleScenarioRun` directly
  - Option B: Make it meaningful - add validation, return job status accurately
- [ ] If keeping:
  - [ ] Return `{ scheduled: true, jobId }` not `{ success: true }` (honest semantics)
  - [ ] Add real validation beyond empty string check
- [ ] Update router accordingly
- [ ] Update tests

### Phase 7: Fix Error Handling
- [ ] `instrumentation.ts` shutdown:
  - [ ] Return error result or rethrow, don't swallow
  - [ ] Caller can decide how to handle
- [ ] Review all catch blocks - no silent swallowing

### Phase 8: Write Real Tests (TDD Retrofit)
- [ ] `orchestrator.unit.test.ts`:
  - [ ] Use test doubles that verify behavior, not call verification
  - [ ] Test: scenario not found → returns failure result
  - [ ] Test: project not found → returns failure result
  - [ ] Test: adapter creation fails → returns failure result
  - [ ] Test: happy path → runs scenario and returns result
  - [ ] Test: tracer shutdown called even on error (finally)
- [ ] `adapter.factory.unit.test.ts`:
  - [ ] Test each factory in isolation
  - [ ] Test registry finds correct factory
  - [ ] Test registry returns error for unknown type
- [ ] `scenario.integration.test.ts`:
  - [ ] Minimal mocking - only external boundaries (LLM calls)
  - [ ] Test actual code paths, not choreography
  - [ ] Use real database (test DB) or repository test doubles

### Phase 9: Clean Up
- [ ] Remove dead code
- [ ] Update PLAN.md to reflect final state
- [ ] Run all tests
- [ ] Run typecheck (CI will catch issues)

---

## Design Principles Checklist

Before committing, verify:

- [ ] **SRP**: Each class/function has ONE reason to change
- [ ] **OCP**: Can add new target type without modifying existing code
- [ ] **LSP**: All adapter factories are interchangeable
- [ ] **ISP**: No interface forces consumers to depend on methods they don't use
- [ ] **DIP**: High-level modules depend on abstractions, not concretions
- [ ] **No magic values**: All configuration in constants
- [ ] **No god functions**: No function > 20 lines
- [ ] **Tests verify behavior**: Not mock call verification
- [ ] **Honest return values**: Don't return success before knowing outcome

---

## File-by-File Changes

| File | Action |
|------|--------|
| `scenario.constants.ts` | CREATE - all config constants |
| `execution/orchestrator.ts` | CREATE - SRP orchestration |
| `execution/orchestrator.types.ts` | CREATE - DIP interfaces |
| `execution/types.ts` | UPDATE - segregate interfaces |
| `adapters/adapter.types.ts` | CREATE - factory interface |
| `adapters/adapter.factory.ts` | CREATE - registry |
| `adapters/prompt.adapter.factory.ts` | CREATE - prompt factory |
| `adapters/http.adapter.factory.ts` | CREATE - HTTP factory |
| `scenario.processor.ts` | UPDATE - thin wrapper |
| `scenario.queue.ts` | UPDATE - use constants |
| `simulation-runner.service.ts` | UPDATE or DELETE |
| `__tests__/*.ts` | REWRITE - real tests |
