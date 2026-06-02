# ADR-023: Reactor-seeded self-perpetuating chain for retention orphan sweep

**Date:** 2026-06-01

**Status:** Accepted

## Context

ADR-022 enforces retention by stamping `_retention_days` on every row and
letting ClickHouse's merge-time TTL drop expired rows. PostgreSQL still
holds rows that reference those traces by `traceId`:

- `Annotation`
- `AnnotationQueueItem`
- `PublicShare`
- `TriggerSent` (nullified, not deleted, to preserve alert history)
- `PinnedTrace`

Without a sweep, these accrue forever, surface as broken UI references,
and keep pin-style state pointing at data that no longer exists.

The cleanup mechanism had to satisfy six constraints:

1. **Per-tenant.** No global table scans, no cross-tenant fan-out.
2. **Wake only tenants that actually ingested.** Inactive tenants
   shouldn't cost work.
3. **No schedulers.** No cron, no BullMQ repeat, no HTTP `/cron`
   endpoint. The user explicitly rejected those after a first draft
   used a 6h cron.
4. **Multi-instance safe.** LangWatch runs N k8s replicas; no
   in-memory-only state.
5. **Resilient to transient failures.** One bad sweep run must not
   silence a tenant's cleanup forever.
6. **Reuses the existing reactor infrastructure** — we already have a
   post-fold side-effect dispatch surface on every pipeline.

## Decision

We will use a **reactor that seeds a per-tenant self-perpetuating BullMQ
chain.** The reactor is the entry point; the chain is the work loop;
there is no scheduler anywhere in the path.

### Topology

```
trace event
   │
   ▼
trace-processing pipeline
   │   (fold → store → reactor dispatch)
   ▼
retentionOrphanSweep reactor
   │   (seed-only; ttl=60s dedup window on the reactor itself)
   ▼
orphan-sweep chain queue   ◄────────────────┐
   │   (BullMQ, stable jobId per tenant)    │
   ▼                                        │
orphan-sweep chain worker                   │
   │   (project lookup → archive check →    │
   │    sweepProject; returns {stopChain})  │
   ▼                                        │
worker.on("completed") listener  ───────────┘
   (re-enqueue same jobId with delay = 24h
    when stopChain=false)
```

### Component responsibilities

| Component | File | Owns |
|---|---|---|
| `createRetentionOrphanSweepReactor` | `data-retention/orphan-sweep/retentionOrphanSweep.reactor.ts` | Fires on every trace event. Seeds the chain only — does not sweep. Short-circuits on `INDEFINITE_RETENTION_DAYS` (nothing will TTL → nothing to sweep). |
| `seedOrphanSweepChain(tenantId, { delayMs? })` | `background/queues/orphanSweepChainQueue.ts` | Adds a chain job with stable `jobId = orphan-sweep-chain:${tenantId}`. Dedup-by-jobId is the canonical 24h gate. |
| `runOrphanSweepChainJob` | `background/workers/orphanSweepChainWorker.ts` | One step: project lookup → archive/deleted check → `sweepProject`. Returns `{ stopChain }`. |
| `handleChainStepCompleted` | same file | Self-perpetuates: on `stopChain=false`, re-seeds with `delay=24h`. Extracted from the worker listener for unit testability. |
| `OrphanSweepService.sweepProject` | `data-retention/orphan-sweep/orphanSweep.service.ts` | Cursor-paginated candidate walk; per-tenant; bounded batches. |
| `OrphanCursorStore` (Redis-backed) | `data-retention/orphan-sweep/orphanSweepCursor.store.ts` | Survives process restarts; 7-day TTL. |

### Load-bearing details

**`removeOnComplete: true` is mandatory.** BullMQ's `jobId` uniqueness
spans every state including `completed` and `failed`. If we held the
completed history (e.g. `removeOnComplete: { age: 24h }`), the listener's
re-enqueue (same jobId, +24h delay) would dedup against the still-resident
completed job and silently no-op — the chain would stall after one step.
Job-history visibility lives in the structured logger + posthog capture,
not the queue's retention window.

**Re-enqueue happens in `worker.on("completed")`, never inside `handle`.**
Re-enqueuing inside the handler races against the still-active jobId;
BullMQ dedups the new add into a no-op. The handler must finish, the job
must transition out of `active`, the job must be removed by
`removeOnComplete: true`, and only then can the new add land.

**`worker.on("failed")` does NOT re-enqueue.** Transient sweep errors are
already swallowed inside the handler (`stopChain: false` is still
returned), so `failed` only fires on permanent failure (3 attempts
exhausted, or thrown-out-of-handler errors). Auto-re-arming on permanent
failure papers over a real signal; instead we log + posthog-capture and
let the next ingest re-seed the chain.

**Cursor persistence is per-project, Redis-backed, 7-day TTL.** Without
persisted cursors, a project with more candidate rows than
`MAX_SWEEP_PAGES × CANDIDATE_LIMIT` (100k) restarts at page 0 every run
and starves the tail. The 7-day TTL means a project that goes inactive
doesn't keep a stale cursor forever.

**Two independent dedup windows.** The reactor has `ttl: 60_000` for its
own dedup so a flood of trace events for one tenant doesn't spam
`seedChain` calls. The chain's stable jobId handles the longer-window
dedup (job lives in `delayed` state for ~24h holding the jobId; ingest
re-seeds during that window are no-ops).

## Rationale / Trade-offs

**Rejected alternatives.**

*Scheduled cron (`@every 6h`).* First draft. Wakes every tenant whether
or not they have data, encodes cadence in infrastructure config instead
of code, adds an HTTP endpoint we have to authenticate and observe, and
needs leader election or idempotent guards on multi-instance. User
explicitly rejected schedulers.

*BullMQ repeatable jobs.* A `repeat: { every: 24h }` job still owns its
own scheduler internal to BullMQ — same conceptual cost as a cron, just
hidden in Redis. Doesn't wake on first ingest (newly-active tenant
accrues orphans before the first repeat fires). Stopping a repeat for an
archived tenant requires explicit removal.

*Read-time lazy cleanup.* Distributes the cleanup logic across every
consumer (annotation list, share resolver, trigger history, queue
items). Rows that are never read are never cleaned. Hard to observe —
no place to put a counter for "orphans cleaned today".

*Inline-sweep reactor.* Couples the ingest hot path to PG/CH multi-table
work; blast radius too wide; no per-tenant cadence control.

**Why the chain works.** Stable per-tenant jobId means chain state is the
queue's own dedup state. Ingestion is the seed event — no ingest, no
chain, no work. The 24h cadence lives in the `worker.on("completed")`
listener; it's an event handler, not an alarm clock. BullMQ jobId
uniqueness is Redis-atomic, so bursty seeds from N pods fold into one
job. Transient sweep errors return `stopChain: false` so the next link
still fires; permanent failures stall until next ingest re-seeds, which
matches the cold-start tolerance brand-new tenants already have.

## Consequences

**Positive.** Zero schedulers. Inactive tenants cost nothing. Multi-instance
is free. One predictable cadence per tenant (1 / 24h). The resilience
boundary is explicit: transient errors → chain continues; permanent
failure → chain stalls and surfaces the error.

**Negative / accepted.** Up to 24h of dangling references can be visible
between chain steps. We considered read-time lazy cleanup as a safety
net and explicitly rejected it (touches every consumer; rows never read
are never cleaned). Archived projects don't get final cleanup
automatically — `stopChain: true` ends the chain; final cleanup is a
manual op via `OrphanSweepService.sweepProjects({ projectIds })`, which
is retained for that purpose. A Redis blip during the listener's
`seedChain` call stalls that tenant until next ingest re-seeds; the
completed handler swallows the seed error to keep the BullMQ event loop
healthy.

**Neutral.** Job history is not in the queue. Visibility lives in
structured logs + posthog. We don't query the queue for history anyway.

## References

- Related ADRs: ADR-022 (data retention, umbrella), ADR-019
  (repository-service layering)
- Code:
  - `langwatch/src/server/data-retention/orphan-sweep/retentionOrphanSweep.reactor.ts`
  - `langwatch/src/server/data-retention/orphan-sweep/orphanSweep.service.ts`
  - `langwatch/src/server/data-retention/orphan-sweep/orphanSweepCursor.store.ts`
  - `langwatch/src/server/background/queues/orphanSweepChainQueue.ts`
  - `langwatch/src/server/background/workers/orphanSweepChainWorker.ts`
- Pipeline wiring: `langwatch/src/server/event-sourcing/pipelines/trace-processing/pipeline.ts`
- Composition: `langwatch/src/server/app-layer/presets.ts`
- Specs: `specs/data-retention/orphan-sweep.feature`,
  `specs/data-retention/trace-pinning.feature`
- Tests: `langwatch/src/server/background/workers/__tests__/orphanSweepChainWorker.unit.test.ts`,
  `langwatch/src/server/data-retention/__tests__/orphanSweep.unit.test.ts`
- PR: #4147
