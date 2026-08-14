# ADR-094: Simulation execution on the process-manager substrate

**Date:** 2026-08-06

**Status:** Accepted

## Context

The simulation-processing pipeline ran its side effects through fire-and-forget
reactors, and the cracks were structural:

- The `scenarioExecution` reactor submitted queued runs to a late-bound,
  in-process execution pool. If the pool was not yet bound when the event was
  processed, or dispatch threw after the event was acknowledged, the run was
  silently dropped — it sat QUEUED forever with no terminal event.
- The `cancellationBroadcast` reactor republished `cancel_requested` over
  ephemeral Redis pub/sub. A lost message (subscriber reconnect, pod down)
  left the child process running with no backstop, and the cancellation
  service dual-wrote `finishRun(CANCELLED)` for queued runs to paper over it.
- Stall handling was read-time derivation (`stall-detection.ts`): it painted
  STALLED cosmetically but never wrote a terminal event, so downstream
  consumers (suite aggregates, metrics, Customer.io) never fired. Two
  boot-time sweeps (`orphaned-run-reconciliation.ts`,
  `scenario-orphan-reconciler.ts`) existed solely to close that gap.
- The sync reactors (`suiteRunSync`, `traceMetricsSync`,
  `snapshotUpdateBroadcast`, `customerIoSimulationSync`) read fold-projection
  state to do their work, coupling them to projection timing and making them
  unsafe under replay.

ADR-052 put automations on the generic process-manager substrate
(revision-fenced durable wakes, leased transactional outbox, per-process PG
inbox/state). The simulation pipeline has the same requirements — per-run
lifecycle, durable dispatch promises, deadline backstops — so it moves to the
same substrate.

## Decision

### `simulation_run_execution` process manager

One process instance per scenario run (process key = `scenarioRunId`),
registered on the simulation-processing pipeline via `.withProcessManager`.
Intents: `execute` (submit to the execution pool), `cancel` (broadcast to the
`scenario:cancel` Redis channel), `finish` (dispatch `finishRun`). All intents
ride the leased PG outbox with deterministic message keys
(`execute:<runId>`, `cancel:<runId>`, `finish:<runId>:<reason>`), so dispatch
is retried up to the outbox's five attempts and redeliveries dedup.

There is no `.schedule()` — wakes are per-run deadlines:

- **Stall watchdog.** Queued/started/activity events arm
  `nextWakeAt = lastActivity + STALL_THRESHOLD_MS` (the constant lives in
  `scenario.constants.ts`). A wake that finds the run quiet past the threshold
  force-finishes it `ERROR` with reason `"stalled"` — a recorded terminal
  event, not a read-time paint.
- **Cancel-grace watchdog.** A `cancel_requested` against a running run emits
  the `cancel` intent and arms `nextWakeAt = now + CANCEL_GRACE_MS` (60s). If
  no terminal event lands within the grace (the pub/sub message was lost, the
  owning pod was down), the wake force-finishes the run `CANCELLED`. A cancel
  against a queued run finishes `CANCELLED` immediately instead of waiting out
  the grace window — the cancellation service no longer dual-dispatches that
  event. It still emits the `cancel` intent, because `queued` does not mean
  undispatched: the execute intent goes out the moment the run is queued, so
  the pool may already hold the job behind a busy slot, and `pool.wasCancelled`
  (set only by the cancellation subscriber) is what stops it spawning. The one
  case that skips the broadcast is a cancel that overtook the queued event, so
  no execute intent was ever emitted.

### Event-carried subscribers

The four surviving reactors became `.withSubscriber` event subscriptions
driven by **event payloads only** — no fold-state reads. To make that
possible, `lw.simulation_run.finished` events now carry optional
`scenarioId` / `batchRunId` / `scenarioSetId` / `traceIds` (event version
2026-08-06), and the DI `FinishRunCommand` backfills them from the aggregate's
own event log (`RunQueued` + message events) when a caller omits them.
`snapshotUpdateBroadcast` and `customerIoSimulationSync` keep a fold
attachment for sequencing only (fire after the fold commits); the handlers
read the event, not the fold.

### `simulation_run_metrics` table

Per-trace cost/latency metrics gain a dedicated ClickHouse table (migration
`00078_create_simulation_run_metrics.sql`), written by a new
`simulationRunMetrics` map projection that appends one row per
`metrics_computed` event. The table is a ReplacingMergeTree keyed
`TenantId / ScenarioRunId / TraceId`, which collapses retry re-deliveries at
read time (exactly-once-under-retry).

**This step is additive, and deliberately so.** The `simulation_runs` fold
still keeps its `TraceMetrics` map and still computes the cross-trace
`TotalCost` / `RoleCosts` / `RoleLatencies` aggregate, and it remains the only
thing the product reads. Nothing is moved off the fold in this ADR, and no
customer-visible read path changes. The new table is the durable per-trace
fact log the aggregate should eventually be derived from; the repository's
`getRunMetrics` is written and integration-tested against the rollup but has
no production caller yet. Cutting the fold's aggregate over to it is a
separate change, because it is a read-path migration with its own backfill
question (the table starts empty, so every run that predates it would read as
zero cost until refolded).

A second migration (`00079_create_simulation_run_metrics_rollup.sql`) adds a
materialized view onto an AggregatingMergeTree rollup so a read does not
re-collapse every raw row. The states are `argMaxState`, not `sumState`,
because a materialized view fires per inserted block: an additive state would
double-count a retried append that landed in its own insert, whereas a retry
re-inserting the same `OccurredAt` and the same values resolves to one value
under `argMaxMerge` whether or not the parts have merged.

### Data boundary: no conversation content in Postgres

PM inbox/state/outbox rows carry only ids, enums, timestamps, and the
execution target. The enforcement point is the `toPayload` event view
(`buildSimulationRunEventView`): it narrows a committed pipeline event to
that view before the runtime builds the envelope, so anything it drops can
never become durable in PG. Conversation content lives only in ClickHouse
(`event_log`, the `simulation_runs` fold, `simulation_run_metrics`).

Convention, stated once and applied pipeline-wide:
`.withProjection` = Postgres, `.withFoldProjection` / `.withMapProjection` =
ClickHouse.

### Deletions

Deleted outright, with no deprecation cycle: the `scenarioExecution` and
`cancellationBroadcast` reactors (the whole `reactors/` dir of the
simulation-processing pipeline), the fold-reading bodies of the sync
reactors, `stall-detection.ts` (read-time STALLED derivation) — stored
status is now the only truth — and both boot-time orphan sweeps
(`orphaned-run-reconciliation.ts`, `scenario-orphan-reconciler.ts`).

Accepted loss: runs queued or in-flight BEFORE the process manager existed
have no process instance, so no stall watchdog covers them — they may never
reach a terminal state. We accept losing those pre-migration rows over the
deployment window rather than keeping the legacy sweeps deployed for a
release cycle.

## Consequences

- A queued run can no longer be silently dropped: the execute intent is a
  durable outbox row that survives worker restarts and is retried until the
  pool accepts it or the outbox's five attempts are spent.
- Cancellation is durable end to end. Redis pub/sub remains the low-latency
  broadcast, but a lost message is backstopped by the cancel-grace wake
  instead of a dual-write in the service layer.
- A stall is a recorded terminal outcome that fires downstream consumers,
  not a per-read recomputation. Watchdog wakes can fire a few seconds late
  (wake polling), but cannot lose a committed deadline.
- Subscribers are replay-safe: event payloads carry everything they need, so
  rebuilding projections cannot re-trigger side effects from stale fold reads.
- PG gains per-run inbox/state/outbox rows; they are id/enum/timestamp-only by
  construction (`toPayload`), keeping the no-conversation-content-in-PG
  boundary enforceable at one function.
- Pre-migration in-flight/queued rows have no process instance and may never
  reach a terminal state — an accepted deployment-window loss. The legacy
  orphan sweeps and the read-time stall derivation are already deleted.

## References

- ADR-052 (automations on the process-manager substrate — the pattern this
  ADR ports to simulations), ADR-049 (process-manager inbox/state/outbox)
- ADR-010 (scenario orphaned-run reconciliation — the boot sweep this ADR
  removes)
- [`specs/scenarios/event-driven-execution-prep.feature`](../../../specs/scenarios/event-driven-execution-prep.feature),
  [`specs/features/suites/cancel-queued-running-jobs.feature`](../../../specs/features/suites/cancel-queued-running-jobs.feature)
- Code: `platform/app/src/server/event-sourcing/pipelines/simulation-processing/process-manager/`,
  `.../subscribers/`, `.../projections/simulationRunMetrics.mapProjection.ts`,
  `platform/app/src/server/clickhouse/migrations/00078_create_simulation_run_metrics.sql`,
  `platform/app/src/server/clickhouse/migrations/00079_create_simulation_run_metrics_rollup.sql`
