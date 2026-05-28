# ADR-023: GroupQueue wakeup pattern for outbox scheduling

**Date:** 2026-05-28

**Status:** Accepted

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

Use the existing `GroupQueue` infrastructure for outbox scheduling. Define a single new queue, `outboxDispatchQueue`, registered globally (not inside any one domain pipeline) under `src/server/event-sourcing/outbox/outboxDispatchQueue.ts`.

**Queue payload is a wakeup only**: `{ reactorName, groupKey }`. The worker reads the actual outbox rows from PG when it fires. The queue is a scheduling primitive; PG is the source of truth.

**Per-trigger FIFO** is guaranteed by setting `groupKey = ${projectId}/${reactorName}:${triggerId}` (or, for non-trigger reactors, whatever stable identifier the reactor defines after the `${projectId}/` prefix). The `${projectId}/` prefix is mandatory: the outbox dispatch queue is a free-standing global queue, not a pipeline command/projection, so `queueManager`'s automatic `${tenantId}/` wrapping does not apply — the producer must include the prefix itself so `tenantIdFromGroupId` (see `src/server/observability/tenantRateTracker.ts`) can extract the tenant and per-tenant fairness via `TenantRateTracker` works.

**Cadence windows** are handled natively by setting `delay = scheduledFor - now()` on send. The queue dispatches the job when the delay elapses; no polling needed.

**One wakeup per cadence window per trigger** is enforced by setting `deduplication: { makeId: () => 'wakeup:' + reactorName + ':' + groupKey, ttlMs: cadenceWindowMs, extend: false, replace: false }`. Subsequent matches within the window dedupe to the existing wakeup; they don't push the dispatch time out.

**Crash recovery** is handled by GroupQueue's existing heartbeat + Lua scripts. The outbox's two-phase status transitions (`queued → dispatching → dispatched`) with `leasedUntil` are a secondary safety net for the rare case where the queue itself loses a job.

## Rationale

### Why GroupQueue and not BullMQ

LangWatch removed BullMQ in PR #4114 ("Skynet BullMQ removal"). GroupQueue is the canonical async-work substrate. Reintroducing BullMQ for the outbox would split the operational story across two queue systems (Redis configuration, metrics, monitoring, crash recovery, ops runbooks) for no benefit. Every capability we'd want from BullMQ is in GroupQueue.

### Why GroupQueue and not a polling drainer

A polling drainer (`setInterval(30_000)` + `FOR UPDATE SKIP LOCKED`) would work — but it re-implements scheduling (delays), fairness (round-robin per tenant), and ordering (FIFO per trigger) that GroupQueue already provides natively. It also introduces a new metric/alarm surface in parallel with the existing one. The polling approach was the initial sketch in the design; the GroupQueue capabilities discovered during code review obsoleted it.

### Why wakeup-only payloads

Putting the full match payload in the queue would duplicate state with PG (the outbox row already has it) and grow queue memory with match volume. With wakeup-only payloads, the queue holds a constant ~50 bytes per pending trigger regardless of match count. PG holds the variable-sized payload data.

The trade-off is an extra PG read on each wakeup — but the read is a single indexed query (`WHERE reactorName=X AND groupKey=Y AND status='queued' AND scheduledFor <= now()`), sub-millisecond at expected volumes.

### Why `deduplication: { extend: false, replace: false }`

The dispatch window is anchored at **first-match time + cadence**. Subsequent matches must join that existing window, not push it out. `extend: true` (the debounce default) would extend the window every time a match arrives, indefinitely. `replace: true` would replace the existing wakeup's payload, which we don't need because payloads are wakeup-only. `extend: false, replace: false` means "first wakeup wins; subsequent dedupes drop the new wakeup silently" — exactly what we want.

If runtime testing in Phase 1 reveals that `extend: false` doesn't behave as the docs imply, fall back to emulating it in app code: check via a small per-trigger Redis SETNX before calling `groupQueue.send`.

## Consequences

- **Operational consistency.** Outbox dispatch shares queue infrastructure with the rest of event sourcing — same Redis, same Grafana panels, same crash recovery code paths.
- **Redis outage stops new wakeups from being scheduled** but outbox rows continue to accumulate in PG. On Redis recovery, a backfill script (`scripts/outbox-rewake.ts`) re-queues wakeups for rows where `status='queued' AND scheduledFor < now()`. Documented in the Phase 0 runbook.
- **PG outage stops dispatch entirely.** Acceptable — PG is the durable record; no other behavior is correct.
- **The dispatch worker is a `GroupQueue` processor**, not a standalone polling cron. Its process role is `worker` (same as other event-sourcing workers).
- **Per-tenant fairness comes for free** via `TenantRateTracker`. No hand-rolled "LIMIT 100 per tenantId" logic.
- **One wakeup per cadence window per trigger** is the structural property that lets a single dispatch handler invocation see all queued matches for that trigger in one batch — the digest semantic.
- **GroupQueue wakeup is a cadence primitive, not a deadline primitive.** "Cadence" = open a window at first match, flush whatever accumulated when the window expires (what this ADR designs). "Deadline" = at +Nmin, re-read state and decide whether to fire — the shape needed by regression-confirmation triggers ("evaluation score dropped; wait 5 min, only fire if it hasn't recovered"). A deadline re-reads source state when it fires; a cadence just drains an inbox. Out of scope here; flagged so a future deadline primitive isn't conflated with `extend: false` wakeups (which would just delay the existing batch flush, not re-query state).

## References

- [ADR-021](./021-transactional-outbox-for-stake-sensitive-dispatch.md) — the outbox pattern this schedules
- [ADR-022](./022-two-tier-dedup-triggersent-reactor-outbox.md) — schema this queue reads
- ADR-007 — event-sourcing architecture (the GroupQueue substrate this builds on)
- [ADR-014 (Skynet BullMQ removal)](./014-skynet-bullmq-removal.md) — why we're not reintroducing it
- `src/server/event-sourcing/queues/groupQueue/` — the queue implementation
- `src/server/event-sourcing/queues/queue.types.ts` — `EventSourcedQueueDefinition`, `DeduplicationConfig`
