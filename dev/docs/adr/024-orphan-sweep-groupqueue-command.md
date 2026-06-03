# ADR-024: Orphan sweep as a self-dispatching groupQueue command

**Date:** 2026-06-03

**Status:** Accepted (supersedes the queue mechanism of ADR-023)

## Context

ADR-023 implemented the retention orphan sweep as a **reactor-seeded
self-perpetuating BullMQ chain**: the ingestion reactor seeded a per-tenant
job on `orphanSweepChainQueue` (a `QueueWithFallback`), and the BullMQ worker's
`completed` listener re-enqueued the next link with a 24h delay.

The 2026-06-02 retention incident (post-mortem RC #2) exposed that this chain
sat on the **wrong queue system**:

- **`:` in the custom jobId is a deterministic landmine.** BullMQ rejects
  custom job ids containing `:` (unless they split into exactly 3 segments).
  The seed jobId `orphan-sweep-chain:<tenant>` was rejected on every `add()`.
- **`QueueWithFallback` treats a deterministic enqueue error as a transient
  Redis outage** and ran the heavy `sweepProject` **inline on the ingestion
  path** — a per-event ClickHouse read-storm that stalled ingestion.
- **Two-queue divergence is the deeper cause.** Orphan-sweep was the *only*
  per-trace-path workload still on BullMQ; everything else in trace processing
  runs on the event-sourcing **groupQueue**, which sanitizes `:` (`replaceAll`)
  and has no inline-fallback footgun. The dev in-memory queue allowed `:`, so
  the failure was invisible until prod BullMQ rejected it.

PR #4518 hot-fixed the symptom (`:`→`-`, `fallbackToInline:false`, best-effort
seed). This ADR removes the root: move the sweep onto the groupQueue so the
failure mode cannot exist, and delete the BullMQ chain entirely.

The six constraints of ADR-023 still hold and must not regress:

1. **Per-tenant**, no global scans.
2. **Wake only tenants that ingested.**
3. **No schedulers** — no cron, no BullMQ repeat, no `/cron` endpoint. (The
   user explicitly rejected schedulers.)
4. **Multi-instance safe.**
5. **Resilient to transient failures** — one bad run must not silence cleanup.
6. **Reuses the existing reactor/command infrastructure.**

## Decision

Run the sweep as a **command-only event-sourcing pipeline** that
**self-dispatches** with a delay — the exact shape already in production for
`billing_reporting`'s `reportUsageForMonth`. The ingestion reactor (kept) now
dispatches the command instead of seeding a BullMQ chain.

### Topology

```
trace event
   │
   ▼
trace-processing pipeline  (fold → store → reactor dispatch)
   │
   ▼
retentionOrphanSweep reactor   (dispatch-only; ttl=60s dedup on the reactor)
   │   getPipeline("orphan_sweep_processing")
   │     .commands.sweepOrphansForTenant.send({ tenantId, occurredAt, consecutiveFailures: 0 })
   ▼
orphan-sweep command   (groupKey = tenantId)        ◄──────────────┐
   │   1. circuit-breaker check (payload-carried)                  │
   │   2. project lookup → archived/deleted? → STOP                │ selfDispatch
   │   3. sweepProject (bounded, cursor resumes)                   │ (pipeline delay = 6h)
   │   4. selfDispatch(consecutiveFailures: 0 | n+1), unless STOP  │
   └───────────────────────────────────────────────────────────────┘
   deduplication: makeId = tenantId, ttlMs = 6h + 10min
```

### Component responsibilities

| Component | File | Owns |
|---|---|---|
| `createRetentionOrphanSweepReactor` | `data-retention/orphan-sweep/retentionOrphanSweep.reactor.ts` | Fires on every trace event. `dispatchSweep`-only. Short-circuits on `INDEFINITE_RETENTION_DAYS`. |
| `SweepOrphansForTenantCommand` | `event-sourcing/pipelines/orphan-sweep-processing/commands/sweepOrphansForTenant.command.ts` | One increment: circuit-breaker → project guard → `sweepProject` → self-dispatch. Catches all errors; emits no events. |
| `createOrphanSweepProcessingPipeline` | `…/orphan-sweep-processing/pipeline.ts` | Command-only pipeline. `delay = ORPHAN_SWEEP_INTERVAL_MS (6h)`, dedup `makeId = tenantId`, `ttlMs = 6h + 10min`. |
| `OrphanSweepService.sweepProject` | `data-retention/orphan-sweep/orphanSweep.service.ts` | Unchanged. Cursor-paginated, per-tenant, ≤ `MAX_SWEEP_PAGES (100)` per call. |
| `OrphanCursorStore` (Redis) | `data-retention/orphan-sweep/orphanSweepCursor.store.ts` | Unchanged. Survives restarts; 7-day TTL. |

### Load-bearing details

**Single 6h self-dispatch delay (drained or not).** Lowest queue pressure:
one job per tenant per 6h. A tenant with more candidates than one increment
clears simply continues next cycle (the cursor persists). This matches
ADR-023's already-accepted "dangling references can be briefly visible between
sweeps." We deliberately did **not** add a fast convergence delay — it would
add queue pressure for a backlog case that is rare in practice (candidates are
distinct traces referenced by PG rows for a project, not all traces).

**The 5-minute active-TTL is a crash-recovery net, not a wall-clock cap.** The
groupQueue heartbeats a job's active key every `activeTtlSec/3` (100s) for the
whole duration, so a legitimately long 100-page increment is **not** falsely
re-dispatched. Re-dispatch fires only if the worker process actually dies — in
which case the increment re-runs from the persisted cursor (re-checking
already-clean traces is idempotent). Hence `MAX_SWEEP_PAGES = 100` is safe and
unchanged; no per-run wall-clock budget is needed.

**Circuit-breaker rides in the payload — no new persistence.** The command
data carries `consecutiveFailures`. A failed `sweepProject` self-dispatches
with `n+1`; a success self-dispatches with `0`. At
`MAX_CONSECUTIVE_SWEEP_FAILURES (5)` the command stops self-dispatching and
posthog-captures. Because the reactor seeds with `consecutiveFailures: 0` and
dedup `replace` semantics let a fresh seed overwrite a pending self-dispatch,
an actively-ingesting tenant keeps retrying (re-seed resets the breaker); the
breaker only ends a *dead* loop for a tenant that has stopped ingesting. The
next ingest re-seeds a fresh loop.

Caveat (groupQueue dedup is staging-scoped): the reseed only *overwrites* the
pending self-dispatch while that job is still **staged**. The self-dispatch is
delayed 6h; in the brief window after a worker pops it (active/dispatched) the
dedup key is stale, so a concurrent reseed stages a *fresh* `cf:0` loop
alongside the in-flight one — momentarily two loops for one tenant. This is
self-healing (the `cf:0` loop wins long-term) and harmless (re-sweeping
already-clean traces via the persisted cursor is idempotent); we accept it
rather than add cross-dispatch locking.

**`:` can never break dispatch again.** The groupQueue sanitizes `:`→`.` in
dedup ids (and the command type / dedup key are tenant-scoped). There is no
inline-fallback path on the groupQueue, so an enqueue problem can never run the
sweep on the caller's path.

## Rationale / Trade-offs

**Rejected alternatives.**

*Keep the BullMQ chain, just fix the jobId (PR #4518).* Stops the immediate
storm but leaves orphan-sweep as the lone per-trace BullMQ workload with the
inline-fallback footgun and the dev/prod `:` divergence. #4518 remains the
standalone hot-fix that unpins the workers; this ADR is the structural fix.

*Move the chain to the groupQueue but keep a heavy 24h single sweep.* A large
tenant's single sweep can exceed several minutes; while the heartbeat keeps it
alive, a smaller bounded increment + cursor is more aligned with the
groupQueue's many-small-jobs model and the 5-min crash-recovery window.

*Scheduled cron / BullMQ repeat.* Rejected in ADR-023 and again here — a
scheduler wakes inactive tenants and encodes cadence in infra. `selfDispatch`
is an event continuation, not an alarm clock.

## Consequences

**Positive.** One queue system for all per-trace-path work. The `:`-rejection
and inline-fallback failure classes are gone for this path. Bounded increments
keep ClickHouse load steady. Self-dispatch + cursor drains big tenants over
several quick increments instead of one long sweep.

**Negative / accepted.** Backlog drain latency for a >100k-candidate tenant
(multiple 6h cycles) — accepted, rare, and a fast convergence delay can be
added later if a real case appears. Archived projects still get final cleanup
only via the manual `OrphanSweepService.sweepProjects({ projectIds })` op
(retained from ADR-023).

**Neutral.** Job history lives in structured logs + posthog, not the queue.

## References

- Supersedes: ADR-023 (orphan-sweep BullMQ chain) — queue mechanism only;
  the sweep semantics (what gets cleaned) are unchanged.
- Related ADRs: ADR-022 (data retention umbrella), ADR-019 (repository/service layering).
- Precedent: `langwatch/src/server/event-sourcing/pipelines/billing-reporting/`
  (`reportUsageForMonth` command + `selfDispatch` + dedup + circuit-breaker).
- Code:
  - `langwatch/src/server/event-sourcing/pipelines/orphan-sweep-processing/`
  - `langwatch/src/server/data-retention/orphan-sweep/retentionOrphanSweep.reactor.ts`
  - `langwatch/src/server/event-sourcing/pipelineRegistry.ts` (`registerOrphanSweepProcessingPipeline`)
  - `langwatch/src/server/app-layer/presets.ts`
- Specs: `specs/data-retention/orphan-sweep.feature`
- Post-mortem: `EPIC/Q2/data-retention/errors/postmortem.md` (RC #2)
- Spec: `EPIC/Q2/data-retention/queue/orphan-sweep-on-groupqueue.spec.md`
- Hot-fix PR: #4518 (standalone, unpins workers)
