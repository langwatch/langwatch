# ADR-023: GroupQueue as the outbox dispatch substrate

**Date:** 2026-05-28 (revised 2026-06-01 alongside [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md))

**Status:** Accepted (revised)

## Context

[ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) establishes `ReactorOutbox` as the durable source of truth for stake-sensitive dispatch state. A scheduling mechanism is still needed to:

- Fire dispatch at the right time (immediate for persist actions; end-of-window for digest cadences).
- Run a single leased dispatcher per trigger window across multiple worker pods, with at-least-once external delivery and per-provider idempotency where the provider supports it (see [ADR-027](./027-typed-dispatcherror-contract.md)).
- Provide per-tenant fairness so one customer's notification storm doesn't starve others.
- Recover gracefully from worker crashes.

New LangWatch features do not use BullMQ — the remaining BullMQ queues under `src/server/background/queues/` are legacy and deprecated. The event-sourcing infrastructure (the substrate for all new async work, including this outbox) runs on `GroupQueue` (`src/server/event-sourcing/queues/groupQueue/`), which already provides:

- Per-group FIFO with cross-group parallelism (via `groupKey`).
- Native delayed dispatch (`delay` parameter + per-send override).
- Job deduplication with `extend` / `replace` modes (debounce vs collapse).
- Per-tenant rate tracking via `TenantRateTracker`.
- Crash recovery via Redis Lua scripts + heartbeat.
- `processBatch` + `coalesceMaxBatch` for collapsing same-group jobs into one invocation.

The naive alternative is a polling drainer (a 30-second cron that `SELECT … FOR UPDATE SKIP LOCKED` from the outbox table). This reinvents most of the primitives above, adds a new operational surface (its own queue, its own metrics, its own recovery story), and conflicts with the existing infrastructure pattern.

## Decision

Use the existing `GroupQueue` infrastructure for outbox dispatch. Define a single dedicated queue, `outboxDispatchQueue` — **separate from the main event-sourcing queue** — registered globally (not inside any one domain pipeline) under `src/server/event-sourcing/outbox/outboxDispatchQueue.ts`.

**Queue payload is the full dispatch context** (trigger identity, target identity, the matched-trace identity, alert metadata — everything the dispatcher needs to fire). The queue is the source of truth for dispatch scheduling and execution; PG is the audit projection (see [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) revision).

**Per-trigger FIFO** is guaranteed by setting `groupKey = ${projectId}/${reactorName}:${triggerId}` (or, for non-trigger reactors, whatever stable identifier the reactor defines after the `${projectId}/` prefix). The `${projectId}/` prefix is mandatory: the outbox dispatch queue is a free-standing global queue, not a pipeline command/projection, so `queueManager`'s automatic `${tenantId}/` wrapping does not apply — the producer must include the prefix itself so `tenantIdFromGroupId` (see `src/server/observability/tenantRateTracker.ts`) can extract the tenant and per-tenant fairness via `TenantRateTracker` works.

**Cadence windows** are handled natively by setting `delay = scheduledFor - now()` on send. The queue dispatches the job when the delay elapses; no polling needed.

**Digest coalescing** is handled by the queue's `processBatch` + `coalesceMaxBatch` configuration: when the cadence window flushes for a trigger, the queue invokes the dispatcher with every same-`groupKey` job currently ready, in one batch. The dispatcher renders one digest from the array of payloads. No application-level `SELECT … FOR UPDATE` against PG.

**Replay dedup** is handled by `deduplication: { makeId: payload => '${reactorName}:${dedupKey}', extend: false, replace: false }`. The original event re-firing (from a replay or a cross-pipeline race) collapses onto the existing pending job; the cadence window stays anchored to the first match's enqueue time.

**Audit projection.** The queue is constructed with a `PgOutboxAuditAdapter` (see [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) revision) so every lifecycle event (`onEnqueue`, `onLeased`, `onDispatched`, `onFailed`, `onDead`) writes/updates a row in `ReactorOutbox`. Operator dashboards read PG, not Redis.

**Crash recovery** is handled by GroupQueue's existing heartbeat + Lua scripts. The audit adapter's `onLeased` / `onFailed` hooks keep the PG `status` in sync; an "audit-lag" metric (jobs the queue considers in-flight that the adapter has not yet acked) alerts when PG falls behind.

## Rationale

### Why GroupQueue and not BullMQ

LangWatch removed BullMQ in PR #4114 ("Skynet BullMQ removal"). GroupQueue is the canonical async-work substrate. Reintroducing BullMQ for the outbox would split the operational story across two queue systems (Redis configuration, metrics, monitoring, crash recovery, ops runbooks) for no benefit. Every capability we'd want from BullMQ is in GroupQueue.

### Why GroupQueue and not a polling drainer

A polling drainer (`setInterval(30_000)` + `FOR UPDATE SKIP LOCKED`) would work — but it re-implements scheduling (delays), fairness (round-robin per tenant), and ordering (FIFO per trigger) that GroupQueue already provides natively. It also introduces a new metric/alarm surface in parallel with the existing one. The polling approach was the initial sketch in the design; the GroupQueue capabilities discovered during code review obsoleted it.

### Why full-payload queue jobs (revised)

The original design used **wakeup-only payloads** — the queue stored ~50 bytes per pending trigger and the dispatcher re-read the variable-size payload from PG. The 2026-06-01 revision flipped that: the queue carries the full payload, PG holds an audit projection.

Reasons for the flip:

- **One source of truth for scheduling.** Wakeup-only meant the queue knew "something is ready" and PG knew "what." Two sources of truth always disagree under failure — a job dispatched from the queue but lost during PG read meant the dispatcher saw `queued` rows that the queue had already considered done, and `leaseGroup` re-fired them.
- **Coalescing is in the queue layer where the locking already lives.** `processBatch` + `coalesceMaxBatch` give us digest grouping for free; the previous design re-implemented it as `SELECT … FOR UPDATE SKIP LOCKED` and had to defend against the queue racing the database.
- **Queue memory is not the bottleneck.** Per-tenant fairness already caps in-flight job counts; payloads of ~1 KB × low thousands of concurrent jobs is well within Redis envelope. The "queue grows with match volume" worry was theoretical at our scale.

The cost is that the queue payload is bigger and Redis is now load-bearing for payload durability — but the GroupQueue's existing heartbeat + recovery already cover that, and `PgOutboxAuditAdapter` provides a parallel durable record for the cases where Redis loses a job (the adapter's `onEnqueue` ran, no subsequent transition fires within a configurable timeout → operator gets paged).

### Why `deduplication: { extend: false, replace: false }`

The dispatch window is anchored at **first-match time + cadence**. Subsequent matches must join that existing window, not push it out. `extend: true` (the debounce default) would extend the window every time a match arrives, indefinitely. `replace: true` would replace the existing job's payload, which we don't want for cadence: each match is its own logical row in the digest, so we need the *batch* of matches at flush time, not the latest. `extend: false, replace: false` means "first match opens the window; subsequent matches enqueue alongside, the queue's `processBatch` folds them at flush" — exactly what we want.

If runtime testing in Phase 1 reveals that `extend: false` doesn't behave as the docs imply, fall back to emulating it in app code: check via a small per-trigger Redis SETNX before calling `groupQueue.send`.

## Consequences

- **Operational consistency.** Outbox dispatch shares queue infrastructure with the rest of event sourcing — same Redis, same Grafana panels, same crash recovery code paths. The outbox dispatch queue and the main event-sourcing queue are distinct `GroupQueueProcessor` instances; they share the runtime but not state.
- **Redis outage halts new dispatches.** Audit rows do not accumulate (no producer side, no consumer side) — the prior "PG keeps a backlog" property goes away with wakeup-only payloads. The compensation is that Redis outages are short and the queue's recovery semantics handle resume cleanly; long outages page operators via the audit-lag metric.
- **PG outage degrades the audit projection but does not block dispatch.** The queue keeps running; the `PgOutboxAuditAdapter` retries adapter writes and the projection eventually catches up. Operator dashboards show audit lag when reconciliation falls behind.
- **The dispatch worker is a `GroupQueue` processor with an audit adapter**, not a standalone polling drainer. Its process role is `worker` (same as other event-sourcing workers).
- **Per-tenant fairness comes for free** via `TenantRateTracker`. No hand-rolled "LIMIT 100 per tenantId" logic.
- **Digest grouping is `processBatch` + `coalesceMaxBatch`,** not application-level `SELECT … FOR UPDATE`. The dispatcher receives a single invocation per cadence window per trigger with every coalesced match's payload.
- **GroupQueue wakeup is a cadence primitive, not a deadline primitive.** "Cadence" = open a window at first match, flush whatever accumulated when the window expires (what this ADR designs). "Deadline" = at +Nmin, re-read state and decide whether to fire — the shape needed by regression-confirmation triggers ("evaluation score dropped; wait 5 min, only fire if it hasn't recovered"). A deadline re-reads source state when it fires; a cadence just drains an inbox. Out of scope here; flagged so a future deadline primitive isn't conflated with `extend: false` wakeups (which would just delay the existing batch flush, not re-query state).

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — the outbox pattern this schedules
- [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — schema this queue reads
- ADR-007 — event-sourcing architecture (the GroupQueue substrate this builds on)
- [ADR-014 (Skynet BullMQ removal)](./014-skynet-bullmq-removal.md) — why we're not reintroducing it
- `src/server/event-sourcing/queues/groupQueue/` — the queue implementation
- `src/server/event-sourcing/queues/queue.types.ts` — `EventSourcedQueueDefinition`, `DeduplicationConfig`
