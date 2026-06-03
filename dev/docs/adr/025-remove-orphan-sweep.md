# ADR-025: Remove the PG orphan sweep entirely

**Date:** 2026-06-03

**Status:** Accepted (supersedes ADR-023; the groupQueue-migration attempt in PR #4524 is closed unmerged)

## Context

ADR-022 enforces retention with ClickHouse-native TTL: expired trace rows are
dropped at merge time. PostgreSQL rows that reference traces by `traceId`
(`Annotation`, `AnnotationQueueItem`, `PublicShare`, `TriggerSent`, `PinnedTrace`)
are *not* dropped by that TTL, so they can outlive the trace they point at.

ADR-023 added a **per-tenant orphan sweep** to delete those PG rows: an
ingestion reactor seeded a self-perpetuating BullMQ chain that walked
candidates and cleaned them. That mechanism turned out to be the costly part of
the system:

- It was the **direct trigger of the 2026-06-02 retention incident** (RC #2): a
  `:` in the BullMQ custom jobId was rejected, `QueueWithFallback` fell back to
  running the heavy sweep **inline on the ingestion path**, and ClickHouse was
  hammered per trace event.
- Containing and re-doing it consumed two follow-up efforts — the #4518 hot-fix
  and a full groupQueue migration (PR #4524) — for a feature whose only job is
  opportunistic cleanup of rows that are, at worst, dangling references in the UI.

The cost/benefit no longer holds: a background deleter of orphaned PG rows is
not worth the operational risk surface and the maintenance it has demanded.

## Decision

**Remove the orphan sweep entirely.** No background process deletes orphaned PG
records anymore. Deleted:

- `data-retention/orphan-sweep/` (service, repository, reactor, cursor store)
- `background/queues/orphanSweepChainQueue.ts`,
  `background/workers/orphanSweepChainWorker.ts`
- all wiring: the trace-processing reactor attach, the `PipelineRegistry` /
  `DataRetentionDependencies` plumbing, the worker registration, the
  `orphan_sweep_chain` job metric + the `data_retention_orphans_swept_total`
  counter, and `specs/data-retention/orphan-sweep.feature`.

PR #4524 (the groupQueue migration) is **closed unmerged** — superseded by this
removal. PR #4518 (the hot-fix) is moot for the storm since the sweep no longer
exists; close it unless its `QueueWithFallback` hardening is wanted on its own.

## Consequences

**Accepted negative.** PG rows that reference TTL-expired traces now accrue
indefinitely:
- `Annotation` / `AnnotationQueueItem` for an expired trace remain (may surface
  as entries pointing at a trace that no longer loads).
- `PublicShare` of an expired trace remains (the link resolves to a missing
  trace).
- `TriggerSent.traceId` keeps pointing at an expired trace.
- `PinnedTrace` of an expired trace remains — the pin resolves to nothing (the
  deleted sweep used to remove these; see `specs/data-retention/trace-pinning.feature`).

None of these corrupts data or crosses tenants; they are stale references for
data the user already let expire. Storage growth is negligible relative to the
trace volume that drove the retention work in the first place.

**Positive.** The ingestion path can never again be coupled to a heavy
multi-table cleanup. One fewer queue, worker, reactor, and Redis cursor to
operate. The retention story is now purely ClickHouse-native TTL (ADR-022).

**If it ever needs to come back.** Prefer **read-time filtering** (skip/hide PG
rows whose trace no longer exists, at the point of display) over a background
deleter — it never couples to ingestion and only does work for rows actually
read. A one-off backfill cleanup op can handle accumulated rows if storage ever
matters. Either would get its own ADR.

## References

- Supersedes: ADR-023 (orphan-sweep BullMQ chain). The groupQueue migration
  (PR #4524) was never merged — no ADR number was assigned on `main`.
- Related: ADR-022 (data retention, CH-native TTL).
- Incident: `EPIC/Q2/data-retention/errors/postmortem.md` (RC #2).
- PRs: #4518 (hot-fix), #4524 (groupQueue migration — closed).
