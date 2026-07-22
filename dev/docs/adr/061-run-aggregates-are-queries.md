# ADR-061: Run aggregates are queries, not pipelines

**Date:** 2026-07-22

**Status:** Accepted

**Related:** ADR-062 (run execution on the process-manager substrate — supplies
the liveness guarantee this ADR's derived status depends on), ADR-034
(event-sourced analytics materialization), ADR-052 (the reactor/process-manager
split this ADR applies to run aggregates).

## Context

Two ClickHouse tables exist only to hold a running total of their own children.

`suite_runs` is written by the `suite_run_processing` pipeline. Every event on
that pipeline — `started`, `item_started`, `item_completed` — is dispatched by
`suiteRunSync.reactor.ts`, which reads the *simulation* fold state and forwards
its fields verbatim. Every column is a `GROUP BY BatchRunId` over
`simulation_runs`: `SuiteId` is `extractSuiteId(ScenarioSetId)` because the set
id encodes it (`__internal__${suiteId}__suite`), the counts are `countIf`, the
pass rate is `countIf(Verdict='success') / countIf(Verdict IS NOT NULL)`, and
the timestamps are `min`/`max`. The `scenarioIds` and `targetIds` carried on
the `started` event are dropped by the projection and read by nothing.

`experiment_runs` is the same shape with a smaller derived fraction. Its
`Progress`, `CompletedCount`, `FailedCount`, `TotalCost`, `TotalDurationMs`,
`AvgScoreBps` and `PassRateBps` — plus the four fields the projection itself
labels *"Raw counters for incremental aggregation"* — are a `GROUP BY RunId`
over `experiment_run_items`. Unlike `suite_runs`, it also carries genuine
run-level facts that no item holds: `ExperimentId`, `WorkflowVersionId`,
`Targets`, `Total`, and `StoppedAt` (a run can be stopped with no item ever
changing).

Materializing those aggregates is strictly worse than computing them:

- **The counters are non-idempotent.** They are `StartedCount + 1` increments
  applied on at-least-once delivery, so a redelivery drifts them up.
- **`suiteRunSync` swallows every failure** as "non-fatal", so a dropped
  forward drifts them down. Permanently.
- **`suite_runs` cannot be rebuilt.** A fold projection is meant to replay from
  the event log, but this stream is produced by a reactor and replay does not
  run reactors (ADR-052). Replaying `suite_runs` replays a derived stream that
  no longer exists upstream, so drift is not recoverable. (`experiment_runs`
  does not have this problem — those events are dual-written straight from the
  orchestrator and the pipeline mounts no reactors at all.)
- **Drift changes user-visible run status**, because both projections go
  terminal on `progress >= Total`. Under-count hangs a run at `IN_PROGRESS`
  forever; over-count reports it finished early.

The denominator makes that last failure mode reachable without any drift at
all. `SuiteRunService.startRun` fans out its per-item `queueRun` dispatches
under `Promise.allSettled` and never inspects the results. If one dispatch
fails, `Total` still says 6, only 5 items can ever complete, and the suite run
sits at `IN_PROGRESS` with a null `FinishedAt` for the rest of time.

Meanwhile `experiment_run_items` is already keyed `(TenantId, RunId,
ProjectionId)` — the same leading prefix as `experiment_runs` — so the
aggregate it feeds is a primary-key range scan away.

## Decision

Run aggregates become queries over the rows they summarise. Where an aggregate
holds facts its children do not, it keeps only those facts.

### Suite runs stop being a pipeline

The suite read path is already derived, and `suite_runs` is already dead.
`SuiteRunService.getSuiteRunState` and `getBatchHistory` have no callers; the
only method anything invokes is `startRun`. The suites UI reads its batch
history through `SimulationClickHouseRepository.getBatchHistoryForScenarioSet`,
which groups `simulation_runs` by `BatchRunId` with an IN-tuple dedup,
`ArchivedAt IS NULL`, cursor pagination and a partition-pruning window. The
aggregate-the-children pattern this ADR argues for is therefore not a proposal
— it is what already serves users, and `suite_runs` is a second copy of it
that is written on every scenario start and finish and read by nobody.

So this is a deletion, not a rewrite. Remove `suite_run_processing` in full —
the pipeline, its three commands and three events,
`SuiteRunStateFoldProjection`, its repositories, the `suite_runs` ClickHouse
table — along with `suiteRunSync.reactor.ts` on the simulation pipeline,
`SuiteRunClickHouseRepository`, and the two unreachable service methods.

That the surviving path counts differently from the deleted one is itself
evidence for the direction: `getBatchHistoryForScenarioSet` counts
`FAILED`, `FAILURE`, `ERROR` and `CANCELLED` as failures, while the fold
tested `status === "FAILURE" || status === "ERROR"` against values drawn from
`ScenarioRunStatus`, which has no `FAILURE` member at all. Every `FAILED` and
`CANCELLED` run was being counted as a success by the projection nobody read.

### Status is derived from the runs, not from a denominator

A batch is finished when none of its simulation runs is still in flight, and
failed when any of them failed. Nothing compares a progress count against an
expected total, which is what removes the hang.

It is also why this ADR depends on ADR-062: a derived status only terminates
if every simulation run reaches a terminal state, which is exactly the
guarantee the execution process manager provides. Until ADR-062 lands, a run
abandoned at `QUEUED` keeps its batch in flight — the same symptom as today,
from a cause ADR-062 removes at the source rather than one no sweep can
repair.

### The denominator is carried by the children

The surviving read path counts rows, so it cannot distinguish "this batch has
five runs" from "this batch wanted six and only queued five". `simulation_runs`
gains a `BatchTotal UInt32` column, written from the `queued` event, which
`SuiteRunService.startRun` already computes as `scenarios × targets ×
repeats`. Ad-hoc single runs write 1. Batch history reports `max(BatchTotal)`
alongside the row count.

The denominator therefore arrives with the first child row rather than from a
separate stream, it is in the simulation event log so a replay reproduces it,
and a partial fan-out shows an honest "5 of 6" instead of silently redefining
the batch as five. Rows written before this column exists read 0, and a zero
total means "count the rows" — historical batches display their actual child
count.

The field is added to the `queued` event schema without a version bump. The
event version is asserted with `z.literal`, so bumping it would stop every
already-committed `queued` event from parsing; an optional additive field is
the compatible change.

### Experiment runs keep their facts and derive their counters

`experiment_runs` keeps `RunId`, `ExperimentId`, `WorkflowVersionId`,
`Targets`, `Total`, `StartedAt`, `StoppedAt` and `FinishedAt`. `Progress`,
`CompletedCount`, `FailedCount`, `TotalDurationMs`, `AvgScoreBps`,
`PassRateBps` and the four raw accumulators are dropped from the projection
and computed by grouping `experiment_run_items` on `(TenantId, RunId)` — a
primary-key range scan, not a bloom-filtered scan.

### The trace-cost path is deleted, not repaired

`TotalCost` is the one field where the pipeline duplicates a *correct* derived
path rather than a merely redundant one, and the duplicate is the broken copy.

The written path: `experimentMetricsSync.reactor.ts` sits on the
**trace-processing** pipeline, debounces 60s per trace, and dispatches
`computeExperimentRunMetrics` carrying the trace's cost. The fold folds it into
`TotalCost`, keeping an unbounded `Record<traceId, { totalCost }>` —
`TraceMetrics` — so it can subtract a trace's previous figure before adding the
new one.

That path yields three different answers for the same event log:

- **Live fold, warm cache.** `TraceMetrics` rides along inside the serialised
  fold state in `RedisCachedFoldStore` (300s TTL), so the subtraction works and
  the answer is right.
- **Live fold, cold cache.** `experiment_runs` **has no `TraceMetrics` column**
  — the read mapper hardcodes `{}`. On any fall-through to ClickHouse the map
  is empty, nothing is subtracted, and a reprice adds the trace's full cost on
  top of its own earlier figure.
- **Any re-fold or replay.** The command's idempotency key is
  `${tenantId}:${runId}:trace-metrics:${traceId}` — identical for every
  reprice — and `deduplicateEvents` runs on every event-store read keeping the
  *first* occurrence. Every reprice is discarded, so the run is stuck at the
  earliest and lowest figure.

Repricing is the normal case, not an edge: the reactor re-fires whenever spans
land after its window, each time with a higher running total. So the projection
is not merely non-idempotent, it is non-convergent — which the fold's own
doc comment denies, claiming the state "converges to the same value whichever
order events are seen in".

None of this is worth repairing, because **nothing reads `TotalCost`**.
`mapClickHouseRunToExperimentRun` pulls the column into its row type and then
drops it; the returned `ExperimentRun` carries cost only in `summary`, which is
built from `sumIf(TargetCost, …)` / `sumIf(EvaluationCost, …)` grouped over
`experiment_run_items`. Where an item has no cost of its own — SDK experiments
report none — `enrichItemsWithTraceCosts` reads `trace_summaries` at read time,
resolving the latest version through the IN-tuple dedup and splitting a shared
trace evenly across the targets under it.

That read-time path is already correct on every count the written one fails:
it reads the current price rather than a debounced snapshot, it cannot drift
because it accumulates nothing, and it needs no guard against redelivery
because there is no delivery.

The two also disagree on what a trace's cost *means*. The read path fills in
a trace's price only where the item reports no cost of its own
(`TargetCost IS NULL`), treating the two as alternative sources for the same
figure. The fold added them, so a target that reported its cost inline *and*
produced a trace was counted twice — a test named "combines trace costs with
inline target/evaluator costs" pinned exactly that.

So the decision is deletion, end to end: the `experimentMetricsSync` reactor,
the `computeExperimentRunMetrics` command, the `traceMetricsComputed` event,
the `TraceMetrics` map, and the `TotalCost` field. The late-bound
`wireExperimentDeps` dance in `pipelineRegistry.ts` — which exists only to
hand the reactor a `lookupExperimentId` that queries `experiment_runs` on every
experiment trace — goes with them.

This also takes work off the busiest pipeline in the system: every trace fold
currently evaluates the reactor's `shouldReact`, and every experiment trace
enqueues a delayed job and a ClickHouse lookup, to maintain a column no reader
consumes.

### Migration

Expand/contract, in that order, because a rolling deploy runs migrations while
old replicas are still reading:

1. Add `BatchTotal` to `simulation_runs` and stop writing `suite_runs`. Old
   replicas still writing it are harmless, because nothing reads it.
2. Delete the trace-cost path and stop writing `experiment_runs.TotalCost`.
   The column stays; omitted from the insert it reads NULL, which is what a
   run with no priced trace already reads today.
3. One release later, drop the `suite_runs` table and the `experiment_runs`
   counter and cost columns.

`suite_runs` is not backfilled or migrated. Nothing reads it, and the path
that does serve users already reads the source those rows were derived from.

## Consequences

- Two classes of run-status bug disappear rather than being reaped: counter
  drift cannot exist because there is no counter, and a partial fan-out
  reports a shortfall instead of hanging.
- A whole pipeline, a ClickHouse table, a cross-pipeline reactor, three
  commands, three events, a fold projection, a repository and two unreachable
  service methods are deleted.
- Two ClickHouse writes disappear from the hot path of every scenario start
  and finish, along with the cross-pipeline command dispatch that produced
  them.
- No read path changes, because the one users depend on already aggregates
  `simulation_runs`. The risk of this half is confined to deleting things and
  to one added column.
- The `idempotencyKey` that `POST /api/suites/:id/run` accepts loses its last
  consumer, because the only thing it ever deduplicated was the
  `suite_run.started` event. That was never an idempotency guarantee anyone
  could observe: a repeated submit mints fresh `scenarioRunId`s and queues a
  full second set of runs regardless, so before this change a double submit
  left one suite-run record claiming N items beside 2N real simulation runs.
  The observable behaviour is unchanged and is now pinned by a test.
  Giving the key real force — by deriving run ids from
  `(idempotencyKey, scenarioId, targetId, repeat)` so the fan-out re-dispatches
  identical `queueRun` commands and the event log collapses them — is a
  separate change, and belongs with ADR-062's dispatch identity rather than
  here.
- The `suite_runs` retention and TTL entries stay until the drop migration, so
  existing rows keep ageing out of a table nothing writes.
- Deleting the trace-cost path removes a cross-pipeline reactor, a delayed job
  and a per-trace `experiment_runs` lookup from the trace-processing hot path,
  and removes an unbounded per-run map from fold state that was being
  serialised into Redis on every event.
- The user-visible cost does not change, because it was never coming from the
  deleted path. The residual risk is a consumer of `experiment_runs.TotalCost`
  outside this repository: nothing in `langwatch/src` reads it, but a
  dashboard or an ad-hoc query could. Such a consumer is today reading a figure
  that is wrong in one of three ways depending on cache residency, so the
  column is not a value anything should have been trusting.
- Two earlier revisions of this ADR were wrong about this path — first
  claiming `TraceMetrics` was persisted and costly to write, then claiming the
  fix was to move per-trace cost into `experiment_run_items` rows. Both
  assumed `TotalCost` had a reader. It does not, and the correct cost path
  already exists on the read side.
- Aggregates become self-healing: a corrected or late child row changes the
  answer on the next read, with no projection to rebuild.
- Suite runs no longer have an event stream of their own, so anything that
  wants suite-level history reads simulation runs. Nothing does today.

## References

- [`specs/suites/suite-run-aggregates.feature`](../../../specs/suites/suite-run-aggregates.feature)
- [`specs/experiments-v3/experiment-run-aggregates.feature`](../../../specs/experiments-v3/experiment-run-aggregates.feature)
- ADR-062 (run execution on the process-manager substrate)
- [`dev/docs/best_practices/clickhouse-queries.md`](../best_practices/clickhouse-queries.md)
