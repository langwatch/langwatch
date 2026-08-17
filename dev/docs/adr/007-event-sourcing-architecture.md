# ADR-007: Event Sourcing Architecture

**Date:** 2026-02-14

**Status:** Accepted

**Supersedes:** [ADR-002](./002-event-sourcing.md)

**Hardened by:** [ADR-066](./066-projection-clickhouse-cached-store.md) — projection storage (the ClickHouse-cached read-back store) makes this ADR's "fold state = stored data" and "`store.get()` loads last state" the mandatory, non-optional contract, and retires the `refoldOnStoreMiss` / `refoldOnOutOfOrder` accretions that had drifted from it.

## Context

LangWatch uses event sourcing for traces, evaluations, experiment runs, and simulations. ADR-002 established the core principle — immutable events, derived projections, branded TenantId. This ADR documents the full architecture after the fold/map projection refactoring, which replaced the earlier handler/checkpoint system with a simpler model.

The previous architecture used event handlers (class-based, async), a checkpoint store (ClickHouse + Redis cache), and a projection updater that rebuilt from scratch on each event. This was complex, fragile, and hard to reason about. The refactoring simplified it to two projection primitives — fold and map — with no checkpoints needed.

## Decision — Pipeline Model

Each domain has a **pipeline** that defines:

- **Commands** — validated payloads that produce events (e.g., `RecordSpanCommand`)
- **Events** — immutable facts stored in ClickHouse `event_log` (e.g., `SpanReceivedEvent`)
- **Fold projections** — stateful aggregations per aggregate (e.g., `TraceSummary`)
- **Map projections** — stateless per-event transformations (e.g., `SpanStorage`)
- **Reactors** — post-fold side-effect handlers (e.g., `EvaluationTrigger`)

Four production pipelines exist: `trace_processing`, `evaluation_processing`, `experiment_run_processing`, and `simulation_processing`.

Pipelines are defined statically using `definePipeline()` and registered with `EventSourcing.register()`. No runtime builder or dynamic configuration.

## Decision — Fold Projections (Incremental)

Fold projections accumulate state one event at a time:

1. Load existing state from store (or `init()` if none)
2. `state = apply(state, event)`
3. Store result

**Fold state = stored data.** No intermediate types. `apply()` writes camelCase or PascalCase fields that map directly to ClickHouse or Prisma columns. The store is a dumb read/write layer.

Fold projections run on a **GroupQueue** (BullMQ + Redis) that guarantees per-aggregate FIFO ordering via BullMQ's `group` parameter. This means events for the same aggregate are always processed one at a time, in order.

`apply()` must be pure — no side effects, no async. All I/O happens in the store layer.

## Decision — Map Projections (Stateless)

Map projections transform each event independently:

1. `record = map(event)`
2. `store.append(record)`

Map projections run on a **SimpleQueue** (BullMQ). No ordering guarantees needed because each event is processed independently.

`map()` is a pure function: event in, record out (or null to skip). The `AppendStore` handles persistence.

## Decision — Reactors (Post-Fold Side Effects)

Reactors are side-effect handlers that fire after a fold projection successfully updates and persists its state.

1. `FoldProjection.store()` succeeds
2. `Reactor.handle(event, { foldState, ... })` is dispatched

Reactors allow reacting to the *newly computed state* of an aggregate. They are dispatched asynchronously via a **SimpleQueue**. If a fold fails, its reactors never fire, guaranteeing that reactors always operate on a consistent, persisted state.

## Decision — No Checkpoints

The fold state serves as both data store and checkpoint. Rationale:

- GroupQueue provides per-aggregate ordering
- Fold is deterministic — same state + same event = same result
- If `apply()` throws, BullMQ retries; fold state stays at last good version
- On recovery, `store.get()` loads last state, next event continues from there

This eliminated the checkpoint store (ClickHouse table + Redis cache), the checkpoint key generator, and the checkpoint validation system — roughly 2,000 lines of code.

## Decision — Global Projection Registry

Cross-pipeline projections (e.g., daily event counts, SDK usage) use a `ProjectionRegistry` that receives events from all pipelines after local dispatch. The registry creates its own `ProjectionRouter` and `QueueManager` with the virtual pipeline name `global`.

Events flow: `EventSourcingService.storeEvents()` → local `ProjectionRouter.dispatch()` → `ProjectionRegistry.dispatch()`.

## Decision — Process Roles

The runtime supports two roles to optimize resource usage and prevent event loop contention:

- **web**: Only dispatches commands and events to queues. Does not start BullMQ workers.
- **worker**: Starts all BullMQ workers for projections, reactors, and command handlers.

This ensures that the web servers remains responsive to HTTP requests while background processing is offloaded to dedicated workers.

## Consequences / Rules

1. **Events are immutable** — append only to `event_log`
2. **TenantId required everywhere** — branded type, validated on every operation
3. **Fold state must be serializable** — no Sets, Maps, or functions
4. **`apply()` must be pure** — no side effects, no async
5. **Stores must handle ClickHouse eventually-consistent reads** — use `FINAL` or deduplication where needed
6. **One fold store per projection** — the store is a dumb get/store layer, not shared
7. **Map projections are fire-and-forget** — no retry coordination needed beyond BullMQ
8. **Reactors only fire on success** — they are the safe place for side effects that depend on state

## Key Files

```
src/server/event-sourcing/
├── commands/                          # Command types and handler interfaces
├── domain/                            # Branded types (TenantId, AggregateType) and core Event/Projection schemas
├── pipeline/                          # definePipeline() builder and types
├── pipelines/                         # Production pipelines (trace, evaluation, experiment, simulation)
├── projections/                       # Fold/Map projection types, Router, and Global registry
├── queues/                            # GroupQueue (FIFO) and SimpleQueue implementations
├── reactors/                          # Reactor types and base definitions
├── services/                          # EventSourcingService (orchestrator) and error handling
└── stores/                            # EventStore and ProjectionStore implementations (ClickHouse, Memory)
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
                                 Reactor (SimpleQueue)
                                 handle(event, { state })
                                    ↓
                                  ProjectionRegistry.dispatch()  (global projections)
```

## Amendment: the `immediate` dispatch discipline (2026-08-17, authz grants pipeline only)

The web-role rule above ("only dispatches commands and events to queues")
gains one scoped exception. The `authz_grants` pipeline (ADR-092 §13) declares
a dispatch discipline per command:

- **`queued`** (the default, and the rule above unchanged): append →
  GroupQueue → fold → Postgres.
- **`immediate`**: after the event append is durably accepted (the append is
  waited in both disciplines — store-before-dispatch is preserved verbatim,
  ADR-049), the fold applies **inline on the calling path**, in whatever
  process role the caller runs, and only then does the normal queue fan-out
  run. The projection's cursor guard makes the queued second apply a no-op.

Reserved for commands whose effect must hold before the call returns and must
not depend on Redis even when Redis is healthy: `grants.revoke`,
`member_offboarded`, `cutover_rolled_back`, SCIM deprovisioning. This is a
discipline, not degradation — the point is that a revocation has no Redis
dependency by design, which is a different thing from a queued command
falling back when Redis is sick.

Why the event-loop-contention rationale doesn't apply here: the web-role rule
exists for pipelines that process traces per second; grant writes happen a
few times per day per organization, and the inline apply is one cursor-guarded
Postgres upsert. The amendment is scoped to the `authz_grants` pipeline —
every other pipeline keeps the web-role rule exactly as written.

## References

- [ADR-002](./002-event-sourcing.md) — original event sourcing decision (superseded)
- [ADR-006](./006-redis-cluster-bullmq-hash-tags.md) — Redis cluster hash tags for BullMQ
- [ADR-092](./092-unified-authorization-engine.md) §13 — the grants ledger, the one pipeline carrying the `immediate` amendment
