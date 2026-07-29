# ADR-073: Run execution on the process-manager substrate

**Date:** 2026-07-22

**Status:** Accepted

**Related:** ADR-049 (process-manager inbox/state/outbox), ADR-051 (the durable
revision-fenced wake pattern), ADR-052 (automations on the same substrate),
ADR-072 (run aggregates as queries — its derived run status depends on the
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

**The queued window is derived from the batch, not fixed.** The other
deadlines bound a run that has stopped talking; the queued one bounds a run
that has not started. Those are different problems. A run sits in the queue
behind its own batch siblings for as long as the batch takes to drain, so a
fixed queued window is unfalsifiable as a liveness signal: set it tight and it
terminalises the tail of a large healthy batch before it ever runs, set it
slack and it is useless against a small abandoned one. Since ADR-072 puts
`batchTotal` on the `queued` event itself, the window is sized from the batch
the run queued with — a floor matching the progress window, plus an allowance
per sibling, capped. No read, no extra state, and a run whose event predates
the denominator gets the floor, which is the bound it had before. Being late
to an undispatched run costs a stuck row; being early costs a healthy run its
result, so the arithmetic is deliberately biased late.

**Dispatch is at-most-once, on purpose** — a scenario that fails is not re-run,
because it costs money and may have already recorded messages.

> **CORRECTION (2026-07-28): `maxAttempts: 1` does not deliver this, and the
> worked example below it was wrong.** `attempts` is incremented only by
> `markDispatched` and `markFailed`; **leasing does not touch it**. A worker
> hard-killed mid-child calls neither, so when the lease lapses the row is
> re-leased with `attempts` unchanged and the handler sees `attempt = 1` again.
> `maxAttempts` caps *handled* failures only. The claim that "if the worker
> dies the lease lapses, no terminal event ever arrives, and the deadline wake
> finalises the run" is therefore false in the order it matters: the outbox
> redelivers at lease expiry, well before the progress deadline fires, and the
> scenario **re-runs**. Every deploy that killed an in-flight run would re-bill
> it.
>
> At-most-once has to be a property of **the work**, not of the attempt — which
> is ADR-081's rule that dispatch identity is derived, never minted. The
> implementation reads the run's own stored status back before spawning and
> declines if it is no longer dispatchable. That holds across redelivery,
> across a lease lapse, and across a process restart, none of which `attempts`
> survives.
>
> **`maxAttempts` and `leaseDurationMs` are also per-process, not per-intent**
> (`processRuntime.ts`). Setting `maxAttempts: 1` for the manager would
> downgrade `failRun` from three attempts to one — on the write whose loss
> leaves the run in exactly the non-terminal state this process exists to
> prevent. Two intents with opposite retry needs cannot share one knob, so the
> retry budget stays at 3 and `executeRun` is written never to throw after it
> has dispatched. The long lease is shared too: a crashed `failRun` is now
> invisible for the lease window rather than seconds. That is acceptable — the
> run is already dead — but it is a consequence, not a free lunch.

The intent handler throws only for infrastructure faults, and records a
terminal event for scenario-level failures. `leaseDurationMs` exceeds the child
timeout so a live run is never double-spawned.

> **Deleting the drain costs deploy latency, and this ADR framed it as free.**
> `drainInFlightRuns` emitted a terminal failure per in-flight run on graceful
> shutdown — seconds. Without it a redeployed run waits out the full progress
> deadline (~30 minutes) before anything writes its terminal state. The
> paragraph below lists the drain among mechanisms "reconstructing durability
> afterwards", which reads as redundant. It was not redundant; it was *faster*,
> and only the hard-crash case was ever unhandled. This is a real regression on
> the most common path — deploys — and should be weighed rather than assumed
> away. Re-adding a shutdown hook that settles in-flight instances is the
> obvious mitigation and does not conflict with anything here.
>
> **RESOLVED (2026-07-29): the hook was re-added, bounded.**
> `settleInFlightRuns({ pool, deps, timeoutMs })` snapshots the pool's
> in-flight jobs, drains, then awaits a terminal write per run with per-run
> error isolation, the whole thing raced against a 10s budget
> (`SCENARIO_WORKER.SHUTDOWN_SETTLE_TIMEOUT_MS`). The bound is sized against
> the pod's 30s `terminationGracePeriodSeconds` rather than against how long
> the writes take — at most `CONCURRENCY` runs settle at once, each a lookup
> plus one dispatched event, so the budget is only ever spent when something
> downstream is already unhealthy, and shutdown handles run in parallel so the
> rest of the grace period stays available. Exceeding it is not a failure: the
> run keeps its armed deadline and reaches a terminal state the slow way.
> Order is kill-then-record, so a child cannot succeed after we have written
> its failure.

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

> **CORRECTION (2026-07-29): only the liveness half of the experiment side
> landed, and the split above did not.** There is no `executeExperimentRun`
> intent anywhere in the tree. `experimentRunExecution.process.ts` observes the
> run's events, arms and re-arms `nextWakeAt` from `target_result` /
> `evaluator_result`, and finalises a quiet run as failed — and that is all it
> does. **Non-interactive runs still execute inside the web request's own
> process** via the same fire-and-forget `void runExecution()` this ADR
> describes as the problem, and `runStateManager`'s Redis run-state key is
> still live.
>
> The reason is not oversight. `OutboxDispatcherService` leases once and never
> renews, so a whole-run lease has no correct value — an experiment run has no
> bounded duration to size one against. ADR-081 works the consequence through:
> the leasable unit is a *slice of cells*, and a per-cell execution cap is its
> precondition. That cap does not exist yet, so dispatch cannot move until it
> does.
>
> This makes the two run types asymmetric in a way the Decision above does not
> admit: simulations got the leased outbox, experiment runs got only the
> revision-fenced wake. Both still reach a terminal state, which is the
> guarantee this ADR exists for — but pending experiment work is still lost on
> a hard kill, because there is no outbox row holding it. Read the
> "Non-interactive runs" bullet as ADR-081's step 7, not as shipped
> behaviour.

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
This step only *adds* a safety net, and it is what lets both boot sweeps stop
being the mechanism — the replacement is strictly stronger than what it
removes, because it runs continuously rather than at boot.

They are not deleted in the same change, though, and the gap is not fastidious.
The process manager arms deadlines from *live* events, so it is blind to the
population already stuck when it deploys: those runs have no future heartbeat
and nothing to wake against them. The sweeps therefore keep their boot wiring
for one release as a one-time drain of that population, and are deleted in the
release after, once no run predating the cutover can still be open.

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

### What is deleted, and when

**Step 1** stops the two boot sweeps being the mechanism:
`scenario-orphan-reconciler.ts`, `orphaned-run-reconciliation.ts` and
`orphaned-run-reconciliation.clickhouse.ts` keep their boot wiring, but only as
a one-time drain for runs already stuck when this deploys — the process manager
arms deadlines from live events and cannot see that population. They are
deleted one release later, when no run predating it can still be open.

**Step 2** deletes the rest: the read-time `STALLED` derivation in
`stall-detection.ts`; the pending queue and drain path in
`ScenarioExecutionPool`; and the dead `SCENARIO_QUEUE` constants left over from
BullMQ, which no longer has a producer or a consumer anywhere in the codebase.

> **CORRECTION (2026-07-29), superseded the same day.** An earlier note here
> recorded that `resolveRunStatus` had survived step 2 with three production
> consumers still calling it. That is no longer true: all three call sites
> (`simulation-run.mappers.ts`, `simulation.clickhouse.repository.ts`,
> `useRunHistoryPagination.ts`) were removed in this change, a repo-wide search
> found no remaining caller, and `resolveRunStatus` and its test are deleted
> here rather than one release later. `stall-detection.ts` keeps
> `STALL_THRESHOLD_MS`, which the two boot reconcilers still import.
>
> The pending queue also went, but the **drain path came back** in bounded form
> — see the RESOLVED note earlier in this ADR. So the accurate statement of
> what step 2 deletes is: the pending queue, the `SCENARIO_QUEUE` constants,
> and the read-time `STALLED` derivation.
>
> **The boot sweeps stay boot-only, and that is a decision rather than an
> oversight.** They are gated at 30 minutes, so a run queued shortly before the
> cutover deploy is under the threshold at every boot in that rollout and shows
> QUEUED until a later restart inside the 7-day lookback. A repeating timer was
> considered and declined, because the population it would rescue is already
> drained by the release being replaced: the outgoing build's `close()` still
> calls `drainInFlightRuns`, and a rolling deploy is graceful, so the pods going
> away write the terminal state for exactly those runs. What survives that is a
> hard kill, where only the *display* regresses — both deleted call sites were
> pure read paths that wrote nothing, so the stored status was already stuck at
> QUEUED before this change. Against that, `findQueuedRunCandidates` is an
> unfiltered cross-tenant `GROUP BY` with five `argMax` over seven days of
> `simulation_runs`; putting it on a timer would reinstate per-worker periodic
> cross-tenant scanning, which is the thing this ADR exists to retire. With the
> shutdown hook restored, the exposure is one deploy wide, not ongoing.

`STALLED` survives as a *stored* status written by `failRun`, so a stalled run
is a fact in ClickHouse rather than a function of when someone looked at it.

## Consequences

- Every simulation and experiment run reaches a terminal state within a
  bounded time of going quiet, whatever happened to the worker — which is the
  precondition ADR-072's derived suite status needs in order to terminate.
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
- ADR-072 (run aggregates are queries, not pipelines)
- `src/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClustering.process.ts`
  (the in-flight-run and stale-bound precedent)
