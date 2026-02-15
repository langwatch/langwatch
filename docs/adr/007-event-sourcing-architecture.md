# ADR-007: Event Sourcing Architecture

**Date:** 2026-02-14

**Status:** Accepted

**Supersedes:** [ADR-002](./002-event-sourcing.md)

## Context

LangWatch uses event sourcing for traces, evaluations, and experiment runs. ADR-002 established the core principle — immutable events, derived projections, branded TenantId. This ADR documents the full architecture after the fold/map projection refactoring, which replaced the earlier handler/checkpoint system with a simpler model.

The previous architecture used event handlers (class-based, async), a checkpoint store (ClickHouse + Redis cache), and a projection updater that rebuilt from scratch on each event. This was complex, fragile, and hard to reason about. The refactoring simplified it to two projection primitives — fold and map — with no checkpoints needed.

## Decision — Pipeline Model

Each domain has a **pipeline** that defines:

- **Commands** — validated payloads that produce events (e.g., `RecordSpanCommand`)
- **Events** — immutable facts stored in ClickHouse `event_log` (e.g., `SpanReceivedEvent`)
- **Fold projections** — stateful aggregations per aggregate (e.g., `TraceSummary`)
- **Map projections** — stateless per-event transformations (e.g., `SpanStorage`)

Three production pipelines exist: `trace_processing`, `evaluation_processing`, `experiment_run_processing`.

Pipelines are defined statically using `definePipeline()` and registered with `EventSourcing.register()`. No runtime builder or dynamic configuration.

## Decision — Fold Projections (Incremental)

Fold projections accumulate state one event at a time:

1. Load existing state from store (or `init()` if none)
2. `state = apply(state, event)`
3. Store result

**Fold state = stored data.** No intermediate types. `apply()` writes PascalCase fields that map directly to ClickHouse columns. The store is a dumb read/write layer.

Fold projections run on a **GroupQueue** (BullMQ + Redis) that guarantees per-aggregate FIFO ordering via BullMQ's `group` parameter. This means events for the same aggregate are always processed one at a time, in order.

`apply()` must be pure — no side effects, no async. All I/O happens in the store layer.

## Decision — Map Projections (Stateless)

Map projections transform each event independently:

1. `record = map(event)`
2. `store.append(record)`

Map projections run on a **SimpleQueue** (BullMQ). No ordering guarantees needed because each event is processed independently.

`map()` is a pure function: event in, record out (or null to skip). The `AppendStore` handles persistence.

## Decision — No Checkpoints

The fold state serves as both data store and checkpoint. Rationale:

- GroupQueue provides per-aggregate ordering
- Fold is deterministic — same state + same event = same result
- If `apply()` throws, BullMQ retries; fold state stays at last good version
- On recovery, `store.get()` loads last state, next event continues from there

This eliminated the checkpoint store (ClickHouse table + Redis cache), the checkpoint key generator, and the checkpoint validation system — roughly 2,000 lines of code.

## Decision — Global Projection Registry

Cross-pipeline projections (e.g., daily event counts) use a `ProjectionRegistry` that receives events from all pipelines after local dispatch. The registry creates its own `ProjectionRouter` and `QueueManager` with the virtual pipeline name `global_projections`.

Events flow: `EventSourcingService.storeEvents()` → local `ProjectionRouter.dispatch()` → `ProjectionRegistry.dispatch()`.

## Consequences / Rules

1. **Events are immutable** — append only to `event_log`
2. **TenantId required everywhere** — branded type, validated on every operation
3. **Fold state must be serializable** — no Sets, Maps, or functions
4. **`apply()` must be pure** — no side effects, no async
5. **Stores must handle ClickHouse eventually-consistent reads** — use `FINAL` or deduplication where needed
6. **One fold store per projection** — the store is a dumb get/store layer, not shared
7. **Map projections are fire-and-forget** — no retry coordination needed beyond BullMQ

## Key Files

```
src/server/event-sourcing/
├── library/                           # Domain types, projections, services (framework)
│   ├── projections/
│   │   ├── foldProjection.types.ts    # FoldProjectionDefinition, FoldProjectionStore
│   │   ├── mapProjection.types.ts     # MapProjectionDefinition, AppendStore
│   │   ├── projectionRouter.ts        # Dispatches events to fold/map queues
│   │   └── projectionRegistry.ts      # Cross-pipeline projection registry
│   ├── services/
│   │   └── eventSourcingService.ts    # Main orchestrator: store → dispatch → project
│   └── pipeline/
│       └── staticBuilder.ts           # definePipeline() builder
├── runtime/                           # ClickHouse stores, BullMQ queues, runtime wiring
│   ├── eventSourcing.ts               # EventSourcing class: register pipelines
│   └── queue/
│       └── groupQueue/                # Per-aggregate FIFO via BullMQ groups
├── pipelines/                         # Three production pipelines
│   ├── trace-processing/
│   ├── evaluation-processing/
│   └── experiment-run-processing/
└── projections/global/                # Cross-pipeline projections
```

## Diagram

```
Command → CommandHandler → Event[] → EventStore.store()
                                         ↓
                                  ProjectionRouter.dispatch()
                                    ↓                ↓
                              GroupQueue          SimpleQueue
                            (per-aggregate)      (per-event)
                                    ↓                ↓
                           FoldProjection      MapProjection
                          load → apply → store   map → append
                                         ↓
                                  ProjectionRegistry.dispatch()  (global projections)
```

## References

- [ADR-002](./002-event-sourcing.md) — original event sourcing decision (superseded)
- [ADR-006](./006-redis-cluster-bullmq-hash-tags.md) — Redis cluster hash tags for BullMQ
