# ADR-062: Run execution on the process-manager substrate

**Date:** 2026-07-22

**Status:** Accepted

**Related:** ADR-049 (process-manager inbox/state/outbox), ADR-051 (the durable
revision-fenced wake pattern), ADR-052 (automations on the same substrate),
ADR-061 (run aggregates as queries — its derived run status depends on the
liveness guarantee decided here).

## Context

Automations and topic clustering run on the process-manager substrate.
Simulations and experiment runs — the two long-running, user-visible run
types — do not, and each has patched the gap differently.

**Simulations** dispatch through the event-sourced pipeline correctly and then
fall off it. `scenarioExecution.reactor.ts` fires on `queued` and calls
`pool.submit()` fire-and-forget into `ScenarioExecutionPool`, an in-process,
per-pod pool whose overflow queue is a plain array field. Work buffered there
is lost on a hard kill. If the pool has not been wired via `setPool()` yet the
reactor logs a warning and drops the job, and the run orphans at `QUEUED`.
Durability is reconstructed afterwards by three separate mechanisms: a
graceful drain on `close()`, and two cross-tenant ClickHouse sweeps —
`scenario-orphan-reconciler.ts` for orphaned `QUEUED` and
`orphaned-run-reconciliation.clickhouse.ts` for orphaned `IN_PROGRESS`. Both
run **only at worker boot**, so a long-lived pod never re-sweeps and a run
abandoned an hour after the last restart waits for the next one. On top of
that, `stall-detection.ts` derives a `STALLED` status at *read* time that is
never written, so the stored status and the displayed status disagree by
design.

**Experiment runs** have none of that. `experiments-v3/execution/orchestrator.ts`
is an async generator driven inside the web request's own process, started with
a fire-and-forget `void runExecution()`. Progress lives in Redis under
`eval_v3_run:{runId}` with a 24-hour TTL, updated by read-modify-write with no
lock. A pod restart mid-run leaves that key at `running` until the TTL evicts
it and the ClickHouse `experiment_runs` row started-with-no-completion
permanently. There is no reaper of any kind — not even a boot sweep.

**Online evaluations are already durable** and are explicitly out of scope.
They ride the GroupQueue, which gives them 25 attempts with exponential
backoff, an active-key heartbeat, re-staging across restarts, and a group
quarantine breaker. Moving them would add risk to the hot ingestion path and
remove protections rather than add them.

One property of the substrate shapes the decision. `OutboxDispatcherService`
leases a message for a fixed `leaseDurationMs` and holds it for the entire
handler call; there is no lease renewal and no keep-alive. A handler that
awaits a scenario child process — capped at `CHILD_PROCESS.TIMEOUT_MS`, 15
minutes — therefore needs a lease longer than that cap, or a second worker
re-leases the message and spawns the run twice.

## Decision

Both run types get a process manager on their existing pipeline. Neither gets
a new stream, a new table, or a cron.

The substrate supplies two independent guarantees, and this decision uses each
for what it is good at rather than making one carry both:

- the **leased outbox** makes dispatch durable and at-most-once, and replaces
  an in-RAM overflow queue with pending rows in Postgres;
- the **revision-fenced wake** makes the terminal state unconditional, whatever
  became of the worker that took the job.

### `scenarioExecution` on the simulation pipeline

Keyed by `scenarioRunId`, which is already the pipeline's aggregate id.

```ts
.withProcessManager("scenarioExecution", pm => pm
  .state<ScenarioExecutionState>(INITIAL)
  .intent("executeRun", executeRunSchema, runScenario)
  .intent("cancelRun",  cancelRunSchema,  cancelScenario)
  .intent("failRun",    failRunSchema,    failScenario)
  .on(QUEUED,             armDispatch)     // → executeRun, deadline = dispatch grace
  .on(STARTED,            refreshDeadline) // → deadline = progress window
  .on(MESSAGE_SNAPSHOT,   refreshDeadline) // the heartbeat
  .on(TEXT_MESSAGE_START, refreshDeadline)
  .on(TEXT_MESSAGE_END,   refreshDeadline)
  .on(CANCEL_REQUESTED,   requestCancel)   // → cancelRun, deadline = cancel grace
  .on(FINISHED,           settle)          // → nextWakeAt: null
  .on(DELETED,            settle)
  .onWake(failStalled)                     // → failRun, terminal
  .outbox({ maxAttempts: 1, leaseDurationMs: CHILD_PROCESS.TIMEOUT_MS + margin,
            concurrency: SCENARIO_WORKER.CONCURRENCY, batchSize: SCENARIO_WORKER.CONCURRENCY }))
```

**The progress events are the heartbeat.** Every one of them re-arms
`nextWakeAt`. A run that keeps talking keeps pushing its own deadline out; a
run that goes quiet has a wake fire against it. That is the same durable
liveness bound `topicClustering.process.ts` places on a long backlog walk,
and it replaces both boot sweeps and the read-time `STALLED` derivation with
one mechanism that *writes* the terminal state instead of inferring it per
read.

**Dispatch is at-most-once, on purpose.** `maxAttempts: 1` preserves the
existing no-retry contract that `scenario-stalled-no-retry.unit.test.ts` pins:
a scenario that fails is not re-run, because it costs money and may have
already recorded messages. The intent handler therefore throws only for
infrastructure faults, and records a terminal event for scenario-level
failures. `leaseDurationMs` exceeds the child timeout so a live run is never
double-spawned; if the worker dies the lease lapses, no terminal event ever
arrives, and the deadline wake finalises the run. Crash recovery comes from
the wake, not from redelivery.

**The pool stops being a queue.** With pending work held as outbox rows and
concurrency bounded by the dispatcher, `ScenarioExecutionPool` keeps only its
child-process registry — the map cancellation uses to find a child and signal
it. The `_pending` array, `dequeueNext`, and the drain-on-close path go away,
because pending work is now in Postgres and is picked up by whichever worker
leases it next.

### `experimentRunExecution` on the experiment-run pipeline

Keyed by `runId`, same shape: the run's start arms a deadline, each recorded
target or evaluator result re-arms it, completion or stop clears it, and a
fired wake finalises the run as failed.

The two entry paths are treated differently, because they differ in whether
anyone is attached:

- **Non-interactive runs** — `POST /:slug/run` in polling mode, CI/CD, and the
  workflow-evaluation entry point — dispatch an `executeExperimentRun` intent
  and execute on the worker fleet. Nothing is streaming, so there is no
  transport to preserve, and these are the runs most likely to outlive the
  request that started them.
- **Interactive SSE runs** — `POST /execute` — keep executing in-request. A
  human is watching a stream; moving execution to a worker would mean
  rebuilding that transport on the broadcast service, which is a larger change
  than this one. They still register with the process manager and re-arm its
  deadline as results land, so an abandoned or crashed interactive run is
  *recorded as failed* rather than left started-forever.

That split buys the guarantee that actually matters — a run always reaches a
terminal state — without rewriting the orchestrator's transport. Moving the
interactive path onto the worker fleet stays available as a later step and
needs no further decision here.

`abortManager`'s Redis abort flag remains the in-flight signal for a running
generator. What changes is that abort no longer has to be observed for the run
to finish: if the process holding the generator disappears, the deadline wake
finalises the run regardless.

### Sequencing: liveness before dispatch

The `scenarioExecution` process manager lands in two steps, because the two
guarantees it carries have very different risk profiles.

**Step 1 — liveness.** The process observes the run's events, arms a durable
deadline, and writes the terminal state when one fires. Dispatch is untouched:
`scenarioExecution.reactor.ts` and the in-process pool keep doing what they do.
This step only *adds* a safety net, and it is what lets both boot sweeps be
deleted in the same change — the replacement is strictly stronger than what it
removes, because it runs continuously rather than at boot.

The read-time `STALLED` derivation in `stall-detection.ts` survives step 1 and
goes dormant on its own: `resolveRunStatus` returns the stored status whenever
one exists, so once the process writes a terminal state the derivation stops
firing for that run. It has three production consumers including a UI hook, so
removing it is a change to the read path, not to execution, and it belongs with
step 2 rather than being rushed alongside a sweep deletion.

For the same reason step 1 writes `ERROR` (or `CANCELLED`) rather than a stored
`STALLED`: that is exactly what the boot sweeps it replaces wrote, so the
terminal status a user sees does not change. `STALLED` becomes a stored status
in step 2, where `FailureEventParams` grows a single modelled outcome instead of
a second mutually-exclusive boolean beside `cancelled`.

**Step 2 — dispatch.** The reactor is replaced by the leased outbox, the pool
loses its pending queue and drain path, and the read-time `STALLED` derivation
is deleted. This is the invasive half: it moves the execution path for a feature
that costs money per run, and it is worth landing only once step 1 has proven
the deadline arithmetic in production.

### What is deleted

`scenario-orphan-reconciler.ts`, `orphaned-run-reconciliation.ts` and
`orphaned-run-reconciliation.clickhouse.ts` with their boot wiring; the
read-time `STALLED` derivation in `stall-detection.ts`; the pending queue and
drain path in `ScenarioExecutionPool`; and the dead `SCENARIO_QUEUE` constants
left over from BullMQ, which no longer has a producer or a consumer anywhere
in the codebase.

`STALLED` survives as a *stored* status written by `failRun`, so a stalled run
is a fact in ClickHouse rather than a function of when someone looked at it.

## Consequences

- Every simulation and experiment run reaches a terminal state within a
  bounded time of going quiet, whatever happened to the worker — which is the
  precondition ADR-061's derived suite status needs in order to terminate.
- Stuck-run recovery stops depending on a worker restart. The bound becomes
  the deadline, not the deploy cadence.
- Pending scenario work survives a hard kill: it is a Postgres row, not an
  array field.
- Stored status and displayed status agree, because the stall is written.
- A run whose events are merely slow — a very long quiet stretch inside a
  legitimately running scenario — can be failed by its deadline. The progress
  window is therefore set from the child timeout rather than tuned tight, and
  the same events that prove liveness are the ones that extend it.
- Two rows per run now exist in `ProcessManagerInstance` and
  `ProcessManagerOutbox` for the run's lifetime. Dispatched outbox rows are
  pruned on the retention path ADR-052 established.
- Online evaluations keep the GroupQueue's protections and are untouched.

## References

- [`specs/scenarios/scenario-execution-process-manager.feature`](../../../specs/scenarios/scenario-execution-process-manager.feature)
- [`specs/experiments-v3/experiment-run-liveness.feature`](../../../specs/experiments-v3/experiment-run-liveness.feature)
- ADR-061 (run aggregates are queries, not pipelines)
- `src/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClustering.process.ts`
  (the in-flight-run and stale-bound precedent)
