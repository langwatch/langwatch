# ADR-010: Scenario Orphaned-Run Reconciliation

**Date:** 2026-06-23

**Status:** Accepted

## Context

The scenario execution pool is in-process and per worker pod — it holds no cross-process record of which run a worker is executing. When a worker dies mid-run (OOM, crash, deploy, container restart), the in-process `ScenarioFailureHandler` that would emit the terminal `finished` event dies with it. The run is left non-terminal in ClickHouse forever: the UI spins at "Starting"/"Running" and downstream reactors (suite aggregates, metrics, customer.io) never fire. Read-time stall detection (in `stall-detection.ts`) paints the run STALLED cosmetically but never writes a terminal event, so the run never actually leaves the in-flight state.

The fix: every scenarios worker reconciles orphaned runs when it boots. It asks ClickHouse for `IN_PROGRESS` runs whose last activity is older than any live worker could still be holding them, and emits a terminal failure event through the existing idempotent finish path so they go terminal for good and downstream reactors fire.

Related: issue [#3195](https://github.com/langwatch/langwatch/issues/3195), PR [#5006](https://github.com/langwatch/langwatch/pull/5006), spec `langwatch/specs/scenarios/orphaned-run-reconciliation.feature`.

## What we considered

### Decision 0: Which runs this sweep may reconcile

**Option A: `IN_PROGRESS` only — chosen.**
`IN_PROGRESS` means a worker called `startRun`; it had the run in hand. A live
worker hard-caps every child at `CHILD_PROCESS.TIMEOUT_MS` and emits its own
terminal event at the cap, so an `IN_PROGRESS` run idle past 2× that cap
provably has no live worker. That inference is the entire licence to write a
terminal ERROR, and it depends on the run having been *started*.

**Option B: every non-terminal status (`PENDING`/`QUEUED`/`IN_PROGRESS`).**
Rejected — this was the original shape of this ADR, and it was wrong. Nothing
bounds how long a run waits in the queue: the execution pool is
concurrency-bounded, so a run behind a large batch/suite backlog goes stale
while a perfectly healthy worker is still working toward it. Reconciling it
would fail a run that is about to execute — the one outcome this reconciler
must never produce. Staleness is evidence of worker death only *after* the run
was started.

`QUEUED` orphans are a genuinely different failure — no worker ever picked the
run up — and are owned by `scenario-orphan-reconciler.ts` (#3365,
`queued-run-orphan-recovery.feature`). Keeping the two sweeps disjoint by status
means neither can double-write the other's runs, and each can evolve its own
liveness argument. Note the same backlog false-positive applies to that sweep's
`QUEUED` gate; it is pre-existing and tracked there, not fixed here.

### Decision 1: Reconcile threshold

A run is only reconciled once its last activity is older than the longest a live worker could still legitimately be holding it.

**Option A: Reuse `STALL_THRESHOLD_MS` (2× the child-process timeout = 30 min) — chosen.**
A live worker hard-caps every child at `CHILD_PROCESS.TIMEOUT_MS` (15 min,
`scenario.constants.ts` line 38) and emits its own terminal event at the cap.
An `IN_PROGRESS` run quiet for longer than 2× that cap provably has no live
worker. Reusing the read-path's own STALLED boundary (`STALL_THRESHOLD_MS`,
`stall-detection.ts` line 9) keeps read and write paths consistent and leaves
margin past the hard cap for clock skew. The
equality is explicit and co-located:
`orphaned-run-reconciliation.ts` —
`export const ORPHAN_RECONCILE_THRESHOLD_MS = STALL_THRESHOLD_MS`.

**Option B: A tighter or independent threshold.**
Rejected. A threshold below the stall boundary risks
reconciling a run a live pod still owns — the one outcome that must never happen.

### Decision 2: Terminal state written on reconciliation

**Option A: Emit a real `finished(ERROR)` event — chosen.**
The reconciler calls `ensureFailureEventsEmitted` on `ScenarioFailureHandler`
(the same idempotent finish path in-process child crashes already use), which
dispatches a `finishRun` command that writes a terminal `FinishedAt` and
`Status = ERROR` to the event log. This is a real event, not a read-time
projection; it fires the downstream reactors (suite aggregates, metrics,
customer.io) that the run's orphaning had silenced. The `Promise.allSettled`
loop at `orphaned-run-reconciliation.ts` line 113 ensures one failing emit
does not abort reconciliation of the remaining orphans.

**Option B: Cosmetic read-time STALLED paint.**
Rejected. This is what the read-path already does and it is insufficient — it
never writes a terminal event to the log, so `FinishedAt` stays null, the
in-flight aggregate stays inflated, and every downstream reactor stays silent.
The original bug.

### Decision 3: Finalized-status fold guard (`statusAfter`)

**Option A: Guard `Status` transitions in the fold projection once `FinishedAt` is set — chosen.**
`simulationRunState.foldProjection.ts` introduces `statusAfter`:
once `FinishedAt` is set, any subsequent non-terminal status candidate is
dropped and the terminal `Status` is preserved. It is applied at **every**
non-terminal `Status` writer: `handleSimulationRunQueued`,
`handleSimulationRunStarted`, `handleSimulationRunMessageSnapshot`, and
`handleSimulationRunTextMessageStart`.

Review caught that `handleSimulationRunQueued` was initially left out, and a
`queued` event *is* in the fold set — so one arriving after `finished` resurrected
`Status = QUEUED` with `FinishedAt` still set, reproducing the exact zombie this
guard exists to prevent. The guard is only as good as its least-covered writer:
any future handler that writes a non-terminal `Status` must route through it.
(At the `textMessageStart` site the status candidate already preserves a terminal
status on its own, so the guard there is defence in depth rather than
load-bearing — its regression test pins the outcome, not the guard.)

The guard defends against the following: a child process that outlived its dead
parent (reparented) and later POSTs a real `started`/`snapshot` with a
client-supplied `occurredAt` that is AFTER the reconciliation time. Because
the fold executor applies events in `occurredAt` order (and only re-folds when
`occurredAt` is strictly less than what it has already seen), such a late event
applies after the reconcile's `finished` event in logical time and would
otherwise clobber `Status` back to `IN_PROGRESS` while `FinishedAt` stays set —
an unrecoverable zombie the read-time stall path cannot rescue (it only resolves
runs with no `FinishedAt`). With the guard, a late non-terminal event can no
longer resurrect `Status`.

The guard alone was not enough. `handleSimulationRunFinished` sets `FinishedAt`,
so it is the one handler the guard cannot cover, and it left two ways to
reproduce the very zombie the guard exists to prevent. Both were found by
executing the fold rather than reading it, and both are closed here:

1. **A second `finished` rewrote the first.** A child that outlived the parent
   this reconciler already failed would take the run ERROR → SUCCESS, and could
   split the record (an ERROR `Status` carrying the late child's SUCCESS
   `Verdict`). `handleSimulationRunFinished` now returns early once `FinishedAt`
   is set: a run finishes exactly once. The alternative — leaving the overwrite
   in as a "self-heal" for a falsely-reconciled run — is unnecessary now that
   Decision 0 restricts the sweep to runs no live worker can hold, and it
   silently discarded the reconciled state downstream reactors had already acted
   on.
2. **A `finished` event could carry a non-terminal status.** The internal event
   schema types the field as `z.string().optional()` (`schemas/events.ts`), so
   *any* string reaches the fold; even the stricter ingest-route schema
   (`z.nativeEnum(ScenarioRunStatus)`) still admits non-terminal members like
   `IN_PROGRESS`, `QUEUED` and `RUNNING`. The handler wrote it straight through
   alongside `FinishedAt` — a run the reconciler skips (`FinishedAt IS NULL`) and
   read-time stall detection skips (it only resolves unfinished runs). Nothing
   could recover it. A non-terminal explicit status is now rejected in favour of
   the verdict-derived one.

So the invariant *"once `FinishedAt` is set, `Status` is terminal and stays
terminal"* is held by three things together: this guard at **every** non-terminal
`Status` writer, the finish-once early return, and the terminal-status check.
Each is covered by a regression test in
`simulationRunState.foldProjection.unit.test.ts`.

**Option B: Rely on event ordering alone.**
Rejected. Client-supplied `occurredAt` can legitimately post-date the
reconciliation timestamp; the `started`/`snapshot` event may not be
"out-of-order" in the eyes of the executor and would be re-folded in sequence
after the `finished` event.

## Decision

**Threshold:** `ORPHAN_RECONCILE_THRESHOLD_MS = STALL_THRESHOLD_MS` = 30 min (2× child timeout).

**Terminal state:** Real `finished(ERROR)` event via the existing idempotent `ensureFailureEventsEmitted` path, not a cosmetic projection.

**Fold guard:** `statusAfter` in the fold projection prevents a late non-terminal event from clobbering `Status` once `FinishedAt` is set.

**Wiring:** `reconcileOrphanedRunsOnBoot` is called fire-and-forget inside `startScenarioProcessor` (`scenario.processor.ts` line 510) so a large or slow sweep never blocks worker startup.

**ClickHouse query** (`orphaned-run-reconciliation.clickhouse.ts`): cross-tenant by design (boot-time, no single tenant context); uses the IN-tuple dedup pattern to find the latest version per run without materialising heavy columns; partition-pruned on `StartedAt`; gated on `FinishedAt IS NULL`.

## Consequences

**Positive:**
- Orphaned runs reach a terminal state and fire all downstream reactors (suite aggregates, metrics, customer.io).
- The finish path is idempotent, so co-booting pods or a racing owning-worker timeout collapse to a single terminal event — no double-fire.
- Reusing the existing `ScenarioFailureHandler` path means the reconciler inherits all future improvements to that path for free.

**Negative / trade-offs:**
- A run orphaned by a fresh crash is not reconciled at the boot that caused it; it is caught on the NEXT worker boot, once the orphan ages past the 30-min threshold. Read-time STALLED covers the gap cosmetically in the interim. Production workers restart regularly (deploys, maxRuntime self-restart), so the bounded sweep window is acceptable.
- Tenants on private ClickHouse instances (`CLICKHOUSE_URL__*` env vars) are not swept — only the shared client is queried. Tracked as a follow-up under issue #3195.
- The sweep is a cross-tenant query by necessity; each terminal write downstream is then scoped per-run to that run's own tenant.

## References

- Issue: [#3195](https://github.com/langwatch/langwatch/issues/3195)
- PR: [#5006](https://github.com/langwatch/langwatch/pull/5006)
- Spec: `langwatch/specs/scenarios/orphaned-run-reconciliation.feature`
- `langwatch/src/server/scenarios/orphaned-run-reconciliation.ts`
- `langwatch/src/server/scenarios/orphaned-run-reconciliation.clickhouse.ts`
- `langwatch/src/server/scenarios/stall-detection.ts`
- `langwatch/src/server/scenarios/scenario.constants.ts`
- `langwatch/src/server/scenarios/scenario-failure-handler.ts`
- `langwatch/src/server/scenarios/scenario.processor.ts`
- `langwatch/src/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection.ts`
- Related: [ADR-009: OTEL Trace Context Propagation for HTTP Scenarios](009-otel-trace-context-propagation-for-http-scenarios.md)
