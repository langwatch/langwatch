# ADR-010: Scenario Orphaned-Run Reconciliation

**Date:** 2026-06-23

**Status:** Accepted

## Context

The scenario execution pool is in-process and per worker pod — it holds no cross-process record of which run a worker is executing. When a worker dies mid-run (OOM, crash, deploy, container restart), the in-process `ScenarioFailureHandler` that would emit the terminal `finished` event dies with it. The run is left non-terminal in ClickHouse forever: the UI spins at "Starting"/"Running" and downstream reactors (suite aggregates, metrics, customer.io) never fire. Read-time stall detection (in `stall-detection.ts`) paints the run STALLED cosmetically but never writes a terminal event, so the run never actually leaves the in-flight state.

The fix: every scenarios worker reconciles orphaned runs when it boots. It asks ClickHouse for non-terminal runs whose last activity is older than any live worker could still be holding them, and emits a terminal failure event through the existing idempotent finish path so they go terminal for good and downstream reactors fire.

Related: issue [#3195](https://github.com/langwatch/langwatch/issues/3195), PR [#5006](https://github.com/langwatch/langwatch/pull/5006), spec `langwatch/specs/scenarios/orphaned-run-reconciliation.feature`.

## What we considered

### Decision 1: Reconcile threshold

A run is only reconciled once its last activity is older than the longest a live worker could still legitimately be holding it.

**Option A: Reuse `STALL_THRESHOLD_MS` (2× the child-process timeout = 30 min) — chosen.**
A live worker hard-caps every child at `CHILD_PROCESS.TIMEOUT_MS` (15 min,
`scenario.constants.ts` line 38) and emits its own terminal event at the cap.
A non-terminal run quiet for longer than 2× that cap provably has no live
worker. Reusing the read-path's own STALLED boundary (`STALL_THRESHOLD_MS`,
`stall-detection.ts` line 9) keeps read and write paths consistent and leaves
margin past the hard cap for clock skew and queued-but-imminent jobs. The
equality is explicit and co-located:
`orphaned-run-reconciliation.ts` line 39 —
`export const ORPHAN_RECONCILE_THRESHOLD_MS = STALL_THRESHOLD_MS`.

**Option B: A tighter or independent threshold.**
Rejected. A booting pod that is about to pick up a queued job could find that
job quiet for well under 30 min. A threshold below the stall boundary risks
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
`simulationRunState.foldProjection.ts` lines 162–183 introduce `statusAfter`:
once `FinishedAt` is set, any subsequent non-terminal status candidate is
dropped and the terminal `Status` is preserved. This is applied at the three
non-terminal transition sites: `handleSimulationRunStarted` (line 281),
`handleSimulationRunMessageSnapshot` (line 348), and
`handleSimulationRunTextMessageStart` (line 386).

The guard defends against the following: a child process that outlived its dead
parent (reparented) and later POSTs a real `started`/`snapshot` with a
client-supplied `occurredAt` that is AFTER the reconciliation time. Because
the fold executor applies events in `occurredAt` order (and only re-folds when
`occurredAt` is strictly less than what it has already seen), such a late event
applies after the reconcile's `finished` event in logical time and would
otherwise clobber `Status` back to `IN_PROGRESS` while `FinishedAt` stays set —
an unrecoverable zombie the read-time stall path cannot rescue (it only resolves
runs with no `FinishedAt`). With the guard, `Status` stays terminal.

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
