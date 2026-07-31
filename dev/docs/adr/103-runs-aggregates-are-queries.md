# ADR-103: A run's totals are a query; a run's liveness is a process manager

**Date:** 2026-07-29

**Status:** Accepted — the rule is in force. The suite/simulation read path is
fully derived; the experiment-run read path has taken over cost and not yet the
counts, and `experiment_runs` still carries the counter columns those counts are
served from.

**Builds on:** ADR-098 (the fold/map/process-manager distinction this applies to
run-shaped work), ADR-100 (the aggregate-scoped lane, whose mutual exclusion —
not the ordering GroupQueue delivers best-effort — is what a run's fold can
rely on).

**Related:** ADR-099 (`defineTable`, and the `partition.stability` facts the
item-grain reads depend on), ADR-104 (the retry policy, which splits `append`
retryability by whether the sort key already carries a per-record identity —
this item table's does, so its writes are retryable; a plain `MergeTree`
`append` is not).

## Context

A run is work with a denominator: an experiment over a dataset, a suite over its
scenarios, a DSPy optimisation over its steps. Every one of them shows a
customer the same two numbers — how much is done, out of how much there is —
and then decides from those numbers whether the run is over.

Maintaining those numbers as columns on a run row is where it goes wrong.
`experiment_runs` holds `Total`, `Progress`, `CompletedCount`, `FailedCount`,
`TotalScoreSum`, `ScoreCount`, `PassedCount` and `GradedCount`
(`langwatch/src/server/clickhouse/migrations/00002_create_schema.sql:245-258`),
and the fold maintains all of them by increment:
`CompletedCount`/`FailedCount` at
`experimentRunState.foldProjection.ts:191-198`, `Progress` as their sum at
`:206`, `TotalDurationMs` as a running total at `:200-204`, and the four scoring
counters at `:231-237`. `AvgScoreBps` and `PassRateBps` are then computed from
those counters (`:240-243`) and read straight off the row
(`experiments-v3/services/mappers.ts:164-165`, `:288-289`).

An increment is not idempotent, and delivery is at-least-once. So:

- **A redelivered `target_result` drifts `Progress` up.** The columns are
  `UInt32`, so nothing clamps it at `Total`; the customer sees 51 of 50.
- **A dropped update drifts `Progress` down, permanently.** There is no
  recovery, because nothing recomputes the counter from anything — the only
  record of what it should have been is the increment that did not happen.
- **The drift decides terminality.** `isRunFinished`
  (`components/batch-evaluation-results/isRunFinished.ts:9-28`) falls back to a
  wall-clock heuristic — no update for 5 minutes means finished — precisely
  because the counters cannot be trusted to reach `Total`. A run short by one
  item is declared finished by the browser's clock while still reading 49 of 50,
  and a run long by one never reads as clean.

The same shape exists twice more. `suite_runs` carries `Total`,
`StartedCount`, `CompletedCount`, `FailedCount`, `PassedCount` and
`GradedCount` (`00003_create_suite_runs.sql:25-32`) and is dead: nothing under
`langwatch/src` or `langwatch/ee` writes it and nothing reads it — it survives
only in TTL and retention configuration (`clickhouse/ttlReconciler.ts:114-119`,
`data-retention/retentionPolicy.schema.ts:274`), which is why
`clickhouse/schema-catalogue.ts:563-573` cannot state its partition stability at
all. And `dspy_steps` is written by a read-modify-write outside the
event-sourcing engine entirely (`dspy-step.clickhouse.repository.ts:152-206`,
reached from an HTTP handler at `server/routes/misc.ts:1169`), so its
load-mutate-store has no FIFO lane and no high-water mark, even though it
recomputes its totals correctly from the merged set at `:175`.

## Decision

### 1. A run's totals are a query over its items, never counters on the run row

The run row holds only what belongs to the run itself and is written once: which
experiment or suite, which workflow version, which targets, and when it started,
stopped or finished. Every count, sum, rate and cost is computed at read time
from the item-grain table.

The suite path is the worked example. `simulation.clickhouse.repository.ts:438-454`
derives a batch's whole summary — `count()`, `countIf(Status = 'SUCCESS')`,
`countIf(Status IN …)` for failures and for still-running — grouped by
`BatchRunId` over `simulation_runs`. There is no suite-level row being
maintained anywhere; the numbers cannot drift because nothing accumulates them.

Materialising these instead is not merely riskier, it is strictly worse: a
counter needs a correct increment on every delivery *and* no redelivery, where a
query needs only that the row set be right, which the storage engine already
guarantees by key.

### 2. The item table's key is the logical item, and it must be complete

A query-derived denominator is only as good as the item table's identity. If the
key is minted per delivery, redelivery adds a row and the derived count
over-counts — the same defect, relocated.

`experiment_run_items` gets this right in one respect and wrong in another, and
both need stating. Right: `ProjectionId` is a deterministic function of the
logical item, not of the delivery — `IdUtils.generateDeterministicResultId`
(`pipelines/experiment-run-processing/utils/id.utils.ts:27-46`) hashes
`(tenantId, runId, index, targetId[, evaluatorId], resultType)` and mints a KSUID
at epoch 0 with sequence 0, so a redelivered result re-derives the identical id.
With `ReplacingMergeTree(OccurredAt)` and `ORDER BY (TenantId, RunId,
ProjectionId)` (`00002_create_schema.sql:320-322`) a redelivery collapses to one
row, and `count()` over the table is a count of logical items.

Wrong: neither the hash nor the sort key includes `ExperimentId`. Two
experiments that share a `runId` — which the read path documents as a real case
twice, at `experiments-v3/services/experiment-run.service.ts:586-588` and
`:692-696`, because SDK callers reuse a stable `run_id` across
`BatchEvaluation` invocations — produce item rows with identical sort keys. The
read layer separates them correctly, deduping on the full business tuple
including `ExperimentId` (`:606-622`), so the defect is invisible until a
background merge collapses the two rows into one and the older experiment's item
is gone. `experiment_runs` itself is safe: `ExperimentId` is in its sort key
(`00002_create_schema.sql:273`). Only the items are exposed.

The rule this ADR fixes: **every column a run-scoped read filters on must be in
the item table's sort key.** A filter predicate that is not part of the key is a
row the engine is entitled to delete.

### 3. The denominator is the work enrolled, stamped before dispatch

`Total` is a fact about the batch, established from the enrolled set before any
dispatch is attempted, and it travels with the work rather than being held
anywhere central.

`SuiteRunService.startRun` computes `total = activeScenarioIds.length *
activeTargets.length * repeatCount` (`app-layer/suites/suite-run.service.ts:118`)
and stamps it as `batchTotal` on every child's `queueRun` command (`:175`), then
dispatches under `Promise.allSettled` (`:160`). The batch's denominator is
therefore `max(BatchTotal)` over whichever children landed
(`simulation.clickhouse.repository.ts:441`), and a dispatch that failed leaves
the run visibly short of a denominator it still knows — rather than silently
shrinking the target so the run looks complete. The fold carries the value
forward without ever recomputing it
(`simulationRunState.foldProjection.ts:438`, field at `:132-138`).

Counting successful dispatches instead would make `Total` a function of the
failure it is meant to expose: lose one enqueue and the run reports 4 of 4.

Zero means unknown, never zero. `expectedCountsForPage`
(`simulation.clickhouse.repository.ts:148-159`) omits a batch whose
`BatchTotal` is 0 from the map rather than publishing 0, so the read side falls
back to counting rows. Publishing a zero denominator would render as complete.

### 4. Terminal state is derived from the same query as the progress

Whether a run is over and how far along it is are two readings of one
expression, evaluated together. `simulation.clickhouse.repository.ts:442-452`
takes `PassCount`, `FailCount`, `RunningCount` and the two completion timestamps
from a single `GROUP BY BatchRunId` over the same rows.

Deriving terminality separately is what produces a run that is finished and 47
of 50, or running and 50 of 50. A wall-clock fallback such as `isRunFinished`'s
5-minute idle rule is not a safety net for that — it is a second, disagreeing
opinion, computed in the browser from a timestamp that also drifts.

### 5. Liveness is a process manager, and it owns only liveness

The projection owns what is derivable from events. Everything that is not
derivable — the deadline, the wake, the abort signal, the terminal write for a
run nobody is executing any more — is a process manager, because it needs
durable state of its own and produces external effects.

Both run process managers use the run's own result events as the heartbeat
rather than a separate keep-alive: `target_result` and `evaluator_result` re-arm
`nextWakeAt` on a 30-minute progress deadline
(`experimentRunExecutionProcess.types.ts:35`), and a run that goes quiet has a
wake fire against it. Scheduling is from `Math.max(ctx.at, ctx.now)`
(`experimentRunExecution.process.ts:74-76`,
`scenarioExecution.process.ts:105-107`) so a backed-up subscriber cannot write a
deadline in the past and kill a healthy run.

The PM's intent is ordered durable-write-last-that-can-fail:
`createExperimentRunExecutionFailRunHandler`
(`experimentRunExecutionIntentHandlers.ts:59-104`) raises the abort flag first —
best-effort, because it changes what a still-live generator does — then makes
the durable terminal write, which is the only step allowed to fail the intent
and be retried, then updates the Redis run-state record last and swallows its
failure. A terminal write that succeeded while the cache update failed is
correct; the reverse is not.

The PM does **not** dispatch the run's work. Leasing a whole run has no correct
duration, and the leasable unit is a slice of cells with a per-cell time bound.
Liveness needs neither.

### 6. A run's fold does not reconcile order

A run's fold lane is scoped to `(projection, aggregate)` for mutual
exclusion — it stops two concurrent applies to the same run, which is a lost
update no read-time dedup would recover. GroupQueue's FIFO delivery inside
that lane is best effort, not a guarantee: a retried job, a redriven dead
letter or a worker restart can still apply an event out of the order it
occurred. Ordering guards, monotonic clamps and "whichever event is later
wins" reconciliation come out anyway, because what makes a run's fold safe
under reordering is not delivery order — it is that every field the fold
writes is order-invariant.

Run fields sort into the two shapes that survive reordering. The counters —
`CompletedCount`, `FailedCount`, `Progress`, the scoring sums — are
commutative, so the total after applying two events in either order is
identical. `Status` is monotone by rank: `terminalStatusAuthority`
(`simulationRunState.foldProjection.ts:279-283`) ranks `CANCELLED` above the
observed outcomes above `STALLED`, and `supersedesFinishedRun` (`:293-301`)
applies strictly-greater, so a higher-authority terminal declaration wins
regardless of which of two terminal events lands first, and a tie is a no-op.
Rank alone only covers one execution of a run, though: it carries no
generation, so it cannot distinguish a late event belonging to a cancelled
attempt from one belonging to a fresh rerun of the same aggregate id. A rerun
that clears `FinishedAt` to let the run progress again is exactly that case —
a straggling `SUCCESS` from the cancelled attempt reads as a legitimate
terminal declaration for the new one, the cancelled-run-resurrected-as-success
shape. Nothing here reruns a finished run against its own aggregate id today,
so the gap is latent; the day something does, `Status` needs
`(generation, rank)`, not rank alone, to stay order-invariant.

Two comments currently assert a different justification for the same
guards — `scenarioExecution.process.ts:109-113` and
`experimentRunExecution.process.ts:80-83` both state that events arrive "at
least once and out of order" and read that as licence for reconciliation
logic order-invariance already makes unnecessary. At-least-once is right;
out-of-order is not a reason to keep it. The identity-merge those comments
actually guard is load-bearing for a different reason: a later event that
carries no `scenarioId` must not blank one an earlier event established,
which is about *sparse* payloads colliding, not about which one arrived late.

The guards that stay are the ones order-invariance does not already cover:
`statusAfter` (`simulationRunState.foldProjection.ts:205-213`) refusing to
write a non-terminal status once `FinishedAt` is set, and the terminal-rank
check itself. Both defend against redelivery and against two writers, both of
which are real regardless of whether delivery happens to be ordered.
Read-layer dedup in ClickHouse is a third thing and also stays.

## What does not move

- **`suite_runs` is dropped.** It has no writer and no reader; keeping it means
  paying TTL reconciliation and retention mutations against a table nobody can
  describe. Its aggregates are already served by grouping `simulation_runs` on
  `BatchRunId`.
- **`dspy_steps` keeps its read-modify-write, and gains a lane.** Its totals are
  already recomputed from the merged set rather than incremented
  (`dspy-step.clickhouse.repository.ts:175`), which is the right algebra; what
  it lacks is serialisation. It becomes a `fold` with a `replace` store, keyed
  `(experimentId, runId, stepIndex)`, so two concurrent step reports for one
  step cannot both read the same prior state.
- **`dspy_steps` has no TTL in its migration** (`00005_create_dspy_steps.sql`
  declares none) and one at runtime (`ttlReconciler.ts:43-48`, anchored on
  `CreatedAt` at 49 days). The runtime reconciler is the source of truth for
  every table's TTL; the migration is not expected to carry one.

## Rationale / Trade-offs

**Why is a query per read acceptable where a column read used to do?**
Because the item table is keyed with the run in its leading prefix.
`experiment_run_items` sorts `(TenantId, RunId, ProjectionId)` and
`simulation_runs` sorts `(TenantId, ScenarioRunId)` with `BatchRunId` indexed, so
a run's aggregate is a primary-key range scan over contiguous granules, not a
table scan. Bounding the partition column keeps it that way: every derived read
carries an `OccurredAt` or `StartedAt` range computed from the runs in hand
(`experiment-run.service.ts:571-580`, `:698-703`), which is what lets ClickHouse
prune historical partitions instead of reaching into cold storage.

**Why not an `AggregatingMergeTree` over the item grain?**
Because an additive engine cannot tell a re-derivation from a second event: a
redelivery makes the engine add the contribution again. An additive merge is
only safe behind exactly-once delivery, which the event log deliberately does not
offer. Keeping the row set idempotent by key and summing at read time gets the
same convergence with no exactly-once requirement anywhere.

**Why must the denominator travel with every child instead of living on a
batch record?**
A batch record is a second aggregate with its own delivery path, so the
denominator can be missing while the children are present — and the read has no
way to distinguish "batch of 6 that lost one" from "batch of 5". Stamping it on
every child makes the denominator available from whichever row lands first, and
the batch's identity is derived from the active set it was queued against
(`suite-run.service.ts:103-116`) so a batch and its denominator cannot come from
different sets.

**Why is the item table an `append` store rather than `merge`?**
An item is written once per logical item and identified by a deterministic
key — `ProjectionId` is derived from `(tenantId, runId, index, targetId[,
evaluatorId], resultType)`, never from the delivery. That key already carries
per-record identity, so `experiment_run_items` is the `ReplacingMergeTree`
form of `append` ADR-099 defines, not the plain-`MergeTree` form: a duplicate
insert collapses at merge instead of duplicating permanently, which is
exactly what a redelivered result needs, and is why the write is retryable at
the client layer (ADR-104) where a plain `MergeTree` `append` is not. A
`merge` store would forfeit that: it would make the write non-idempotent
under redelivery, oblige the projection to declare an idempotency story it
does not have, and — because ADR-104 never retries an `aggregating` write
regardless of engine — cost retryability with no matching benefit here.

## Consequences

- A drifted counter is no longer recoverable-by-replay because it no longer
  exists. This removes the only class of run defect that replay was ever needed
  for; the derived reads need no backfill, because they read rows that were
  always there.
- Deriving costs a query where a column read used to do. For a run's detail view
  this is a primary-key range scan behind a bounded partition predicate; for a
  list view it is one grouped query over the pairs on the page rather than one
  per run.
- `experiment_runs` is half-migrated, and that is worse than either end state.
  Cost is derived from `experiment_run_items` at read time while `Progress`,
  `CompletedCount`, `FailedCount`, `AvgScoreBps` and `PassRateBps` are still
  served from incremented columns. Two numbers on one screen with different
  idempotency properties means a customer comparing them cannot tell which one
  is lying.
- The `experiment_run_items` key defect is live and its symptom is data loss on
  a background merge, not a wrong number: two experiments sharing a `runId` lose
  the older one's items whenever ClickHouse merges the parts. Adding
  `ExperimentId` to the sort key requires a new table and a copy, because a sort
  key is not alterable in place — and ADR-099 already names a second defect on
  the same table that this re-key must fix alongside the sort key, not ship a
  fresh violation next to. `OccurredAt` is both the `ReplacingMergeTree`
  version column and the partition key (`00002_create_schema.sql:320-321`), a
  single moving column doing two jobs ADR-099 requires a frozen, platform-set
  column for. The re-key adds `ExperimentId` to the sort key, gives the table an
  `AcceptedAt` column, and moves the partition expression and the version
  column onto it, leaving `OccurredAt` as a plain display column — one new
  table and one copy fixes both defects, not two re-keys.
- `suite_runs` disappearing removes a retention-managed table, so the
  `CLICKHOUSE_COLD_STORAGE_SUITE_RUNS_TTL_DAYS` variable and its entries in
  `ttlReconciler.ts` and `retentionPolicy.schema.ts` go with it, along with the
  test that asserts its presence.
- Status vocabularies are now the largest remaining inconsistency, and 4 of them
  exist over one `String` column (`simulationRunState.foldProjection.ts:139`,
  `00002_create_schema.sql:340`): the write-side list
  (`pipelines/simulation-processing/schemas/shared.ts:11-19`, 7 values, no
  `QUEUED`), the fold's own terminal set (`foldProjection.ts:221-228`, 6
  values), the SQL lists (`app-layer/simulations/repositories/simulationRuns.sql.ts:137-160`)
  and the UI enum (`scenarios/scenario-event.enums.ts:29-41`, 9 values, with
  `FAILED` but not `FAILURE`). Three concrete divergences follow from that: the
  fold writes `QUEUED` (`:445`) which its own declared vocabulary does not
  contain; one aggregate query hand-rolls its lists inline
  (`simulation.clickhouse.repository.ts:1151-1153`) instead of using the shared
  constants its sibling at `:443-444` uses; and that inline list defines settled
  by excluding `RUNNING`, a UI-only overlay that is never stored, so the
  exclusion matches nothing. Two queries over the same rows can therefore report
  different completions for one batch.
- `experiment_runs` has no `Status` column at all, so run status is inferred
  from `FinishedAt`/`StoppedAt` — and the terminal write for a stalled run must
  use `stoppedAt`, because there is no third value for "the platform ended
  this" (`experimentRunExecutionIntentHandlers.ts:79-90`). A stalled run is
  presented as a stopped one, and only a best-effort Redis record on a 24-hour
  TTL carries the reason.
- Both process managers' documented delivery contract mis-states what makes
  their reconciliation guards unnecessary. Correcting the comments is not
  cosmetic: "events arrive out of order, so reconcile" is exactly the
  justification that brings reordering-compensation guards back the next time
  someone reads the comment instead of this ADR — the comments need to say
  order-invariance is what the fold relies on, not delivery order.

## References

- `specs/experiments-v3/experiment-run-aggregates.feature` — the derived-totals
  contract, with the one remaining `@unimplemented` scenario naming what the
  read path has not taken over.
- `specs/experiments-v3/experiment-run-liveness.feature` — every run reaches a
  terminal state; 3 scenarios remain `@unimplemented`.
- `specs/suites/suite-run-aggregates.feature` — the suite-level derivation,
  fully bound.
- `specs/scenarios/scenario-execution-process-manager.feature` — the
  `scenarioExecution` deadline, cancel window and terminal write.
- `dev/docs/best_practices/clickhouse-queries.md` — the IN-tuple dedup pattern
  and partition-pruning rules every derived read here depends on.
