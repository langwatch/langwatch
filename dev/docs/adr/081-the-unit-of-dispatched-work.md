# ADR-081: The unit of dispatched work

**Date:** 2026-07-28

**Status:** Accepted — the rule is in force; the dispatch moves are partly built

> **What has shipped, as of 2026-07-29.** Step 1 is done and is now the
> repo-wide rule: dispatched work derives its identity from the work's natural
> key, and roughly a dozen process-manager sites cite this ADR for it. Step 6
> (ADR-073 step 2 for scenarios) is tracked on ADR-073.
>
> **What has not.** Steps 2 and 3 — `evaluationDispatch` and
> `threadIdleEvaluation` as separately keyed process managers — do not exist;
> the trace pipeline has one `evaluationTrigger` process manager, which is
> ADR-075's Class D conversion rather than this ADR's split. Steps 5, 7 and 8
> (the per-cell execution cap, slice dispatch for `POST /:slug/run`, and the
> persisted workbench run definition) are not started: `runStateManager` and
> its Redis run-state key are still live, and the experiment-run process
> manager does liveness only — see ADR-073's correction on the same point.
>
> The status is Accepted rather than Proposed because the decision is settled
> and enforced in code, not because the plan is finished. Read the Sequencing
> section as remaining work.

**Builds on:** ADR-052 (the inbox/state/outbox substrate), ADR-069 (payload cost
is a scheduling input), ADR-072 (run aggregates are queries), ADR-073 (run
execution on the process-manager substrate), ADR-075 (post-event work is
subscribers and process managers).

**Revisits:** no decision either of them made. Where ADR-073 or ADR-075 already
decided something, this ADR says so and moves on. The one place it appears to
overlap — which experiment-run entry points execute on the fleet — is a case
ADR-073 did not classify, not one it classified differently.

## Context

Three ADRs have already chosen the substrate for everything in this area, and it
would be easy to write a fourth that restates them. This one exists because the
substrate choice is not the whole decision. Once you have said "leased outbox",
you still have to say what one leased message *contains*, what one process
instance is *keyed by*, and what makes two dispatches of the same work the *same
work*. None of the three answers those, and each of them is load-bearing in a
different way.

**Already decided — not revisited here:**

| Question | Decided by |
| --- | --- |
| Do simulation runs get a process manager, and in what order? | ADR-073 — `scenarioExecution`, liveness then dispatch. Step 1 shipped |
| Does scenario dispatch leave the in-process pool? | ADR-073 step 2 |
| Does the read-time `STALLED` derivation survive? | ADR-073 — deleted in step 2, `STALLED` becomes stored |
| Do experiment runs get a deadline that writes a terminal state? | ADR-073 |
| Do non-interactive experiment runs execute on the worker fleet? | ADR-073 |
| Does `evaluationTrigger` stop being a reactor? | ADR-075, Class D, migration order step 2 |
| Do run counters stay materialised? | ADR-072 — no. `GROUP BY` over `experiment_run_items` |
| Can a `shouldReact` guard be ported to `enqueue.filter` wholesale? | ADR-075, "the one migration hazard" — no |
| Are online evaluations *executed* durably today? | ADR-073 — yes, the GroupQueue already retries `ExecuteEvaluationCommand` |

**Open, and the subject of this ADR:**

1. Nothing says what a dispatched evaluation, scenario run or experiment cell is
   *identified* by. ADR-072 explicitly deferred this — "belongs with ADR-073's
   dispatch identity rather than here" — and ADR-073 does not contain the words.
2. ADR-075 places `evaluationTrigger` in Class D but not what a Class D instance
   for it *is*. `triggerSettlement` gets away with a Postgres row per instance
   because there is one per configured trigger. An evaluation dispatch keyed the
   same way is one per trace per monitor, which is a different order of thing.
3. ADR-073 says non-interactive experiment runs "dispatch an
   `executeExperimentRun` intent". `orchestrator.ts` is a 2,627-line async
   generator over a flattened cell array. A whole run is not a leasable message,
   for a reason given below that is arithmetic rather than taste.
4. ADR-073 classifies `POST /execute` as interactive and `POST /:slug/run` "in
   polling mode" as non-interactive. `/:slug/run` also serves SSE, chosen by the
   client's `Accept` header (`routes/experiments-v3.ts:446-447`), so one of the
   two entry points is unclassified.

## Decision

### The identity of dispatched work is derived, never minted

A dispatch that may be retried has to be identified by a property of the *work*,
not of the *attempt*. Every id that names a unit of dispatched work is derived
from that work's natural key.

This is the house pattern already, in two of the four places it belongs:

- `customEvaluationSync.reactor.ts` hashes `(traceId, evaluation)` into
  `eval_md5_<hash>`, with a comment saying it does so for idempotency.
- `QueueRunCommand` now derives `scenarioRunId` from
  `(projectId, idempotencyKey, scenarioId, targetRef, repeat)`, which is what
  finally gave `POST /api/suites/:id/run`'s long-accepted, long-ignored
  `idempotencyKey` force. Deriving the id *is* the idempotency: identical
  commands collapse in the event log with no claim table and no round trip.

The two places it is missing are exactly the two this ADR and ADR-075 move to
at-least-once dispatch:

- `evaluationTrigger.reactor.ts:262` mints
  `generate(KSUID_RESOURCES.EVALUATION)` per monitor per invocation, and the
  evaluation aggregate is keyed on that id
  (`ExecuteEvaluationCommand.getAggregateId`). Deduplication today is on the
  *job* (`makeJobId` → `exec:<tenant>:<trace>:<evaluator>`) inside a Redis TTL
  window, not on the aggregate. Under at-most-once reactor dispatch that holds.
  Behind a retrying outbox it does not: two attempts mint two aggregates and the
  event log has no way to know they were one evaluation.
- `orchestrator.ts:1965` mints another one when it bridges an experiment's
  evaluator result into the evaluation pipeline.

So: **before any of this work is dispatched at least once, its id is derived.**
Evaluation ids come from `(projectId, monitorId, subject)` where the subject is
the trace for a trace-level monitor and `(threadId, window)` for a thread-level
one — the same tuple `makeJobId` already builds, promoted from a Redis dedup key
to the aggregate id. Experiment cells come from `(runId, rowIndex, targetId)`,
which is already how `experiment_run_items` is keyed.

The subject tuple alone is not the whole id. It collapses two deliveries of one
evaluation, which is the point — but it would also collapse a *deliberate*
re-evaluation of the same trace by the same monitor onto the completed aggregate
that already exists, so a re-run would silently return the old verdict. The
derived id therefore carries a discriminator for the occasion:
`(projectId, monitorId, subject, occasion)`, where `occasion` is the monitor's
configuration version for an automatic firing and an explicit re-run token for a
manual one. Retries of one occasion share it; a new evaluation of the same
subject does not. Without it, "derive the id" reads as "one evaluation per trace
forever", which is not the rule we want.

This is a precondition, not a consequence. Dispatching at least once with minted
ids converts a lost evaluation into a duplicated one, which is worse: the first
is invisible, the second is billed.

It is also worth doing on its own, before any substrate moves. Today the only
thing standing between a customer and a double-billed evaluation is a Redis key.
`shouldSurviveDispatch: true` — whose only two production users are this reactor's
two branches — works by honouring a still-alive dedup TTL after the job has left
staging. A Redis flush removes the key, so the next trigger stages fresh and the
evaluation runs twice. Derived ids make that collapse in the event log instead,
where a flush cannot reach it.

### First: "online evaluation" is two paths, and only one of them may become event-driven

Everything in this section concerns evaluations **nobody is waiting on** —
trace-driven monitors, dispatched by `evaluationTrigger` after a fold commits.
Those have no caller holding a connection, which is what makes a durable
dispatch the right answer.

**Guardrails are a different path and must stay synchronous.**
`POST /api/guardrails/:evaluator/evaluate` (`routes/evaluations-legacy.ts`)
runs `handleEvaluatorCall(..., isGuardrail: true)`, which does
`result = await runEval()`, records the cost, and returns the verdict in the
response. There is no event, no queue, and no process manager anywhere in it —
the caller is blocked on the answer, because a guardrail that returns after the
request has gone is not a guardrail. **Nothing in ADR-075 or this ADR applies to
it, and moving it onto an event substrate would be a defect, not a migration.**
The distinction is already first-class in the data model:
`EvaluationCostRecorder` writes `CostType.GUARDRAIL` or `CostType.TRACE_CHECK`
depending on `isGuardrail`.

Read "online evaluations" below as "trace-driven monitors" throughout.

**A billing exposure on the asynchronous path, found while establishing the
above.** `executeEvaluation.command.ts` calls
`costRecorder.recordCost(...)` mid-handler, which does an unguarded
`prisma.cost.create` with a freshly minted id. The `Cost` model has `@@index`
entries but **no `@@unique`** on anything that would collapse a repeat, and the
command runs on the GroupQueue's at-least-once delivery. So a failure *after*
the cost is written but *before* the handler completes re-runs the handler and
writes a second `Cost` row. Those rows are not cosmetic:
`license-enforcement.repository.ts` aggregates them for limit enforcement and
`api/routers/costs.ts` reports them.

This predates any work here and is not caused by the reactor retirement — but a
retirement whose whole argument is "make the durable path actually durable"
should not leave an at-least-once handler writing money non-idempotently. The
fix is a natural key on `(projectId, referenceId, traceId, costType)` with an
upsert, and it should ship independently rather than riding a substrate change.

### Online evaluations: the dispatch moves, and the instance is keyed by whatever is waiting

ADR-073's exclusion said online evaluations "keep the GroupQueue's protections
and are untouched", and that is right about **execution** — `ExecuteEvaluation`
retries, heartbeats and re-stages, and nothing here proposes touching it.
ADR-075 already decided the **dispatch** must stop being a reactor. What follows
is the evidence that the exclusion should not be read as covering dispatch, and
the shape the replacement takes.

**The reactor's retry is coupled to the fold's retry, and the two want opposite
things.** `dispatchReactorsAfterStore` runs *after* the fold has stored, and
rethrows (`projectionRouter.ts:1587-1595`). The router's own comment on the
handler it calls says what that costs: "the store already holds this batch, so
the retry re-applies it. Accumulating folds (spanCount + 1, cost sums, id
appends) double-count as a result". `traceSummary` is exactly such a fold —
`spanCount: state.spanCount + 1`. And `spanCount` is the value
`evaluationTrigger` reads to decide whether the trace is past
`MAX_PROCESSED_SPANS` and should stop being evaluated at all. Retrying a lost
evaluation dispatch therefore inflates the counter whose job is to *suppress*
evaluation dispatch. You can have a correct trace summary or a retried dispatch.
Not both.

Nothing that is not fold-attached has this problem, and the difference is
structural rather than incidental: `dispatch()` enqueues fold jobs and
subscriber jobs as separate stages (`projectionRouter.ts:834-884`), each landing
in its own queue job. A handler mounted off the fold that fails retries *its own*
job; a reactor handler that fails retries *the fold*. This alone is most of the
case for moving, and it holds whichever of the two remaining substrates the
dispatch lands on.

**The loss that is genuinely silent is narrower than "reactors lose work", and
it is worse for being narrow.** `dispatchEvaluations` catches a failed send
per monitor and only logs it (`evaluationTrigger.reactor.ts:323-334`). The
reactor then returns successfully, the fold job acks, and that one monitor never
runs. Every other monitor on the trace ran, so nothing about the trace looks
wrong. This is the failure
`specs/monitors/evaluation-dispatch-durability.feature` was written for.

**The wait is real, and it is in Redis.** A thread-level monitor dispatches with
`delay: monitor.threadIdleTimeout * 1000` and a dedup config whose `extend` and
`replace` both default to true — "Debounce Mode where new jobs replace existing
ones and reset the TTL" (`queues/queue.types.ts:28-39`). So the idle window
slides, as intended, as a staged Redis job. That is the same promise ADR-052
found for automation settlement, and the same conclusion applies: a Redis flush
erases a wait the customer was told would happen.

**The instance is the trace, and there is a second one for the wait.** A
process-manager instance is a `ProcessManagerInstance` row, and
`triggerSettlement` affords one per configured trigger. An evaluation dispatch
keyed per trace *per monitor* would be proportional to ingestion volume times
monitor count, on the busiest pipeline in the system — the risk ADR-073 was
pointing at, even though it attached the warning to the execution half. Keyed by
the trace alone it is not: one instance holds the whole match-and-fan-out for a
trace, with one outbox row per matched monitor.

Two processes, because one of them has to wait and the other does not — and the
question that separates them is *how long must the promise outlive the process
that made it?*

- **`evaluationDispatch`, keyed by `traceId`.** Mounted on the trace pipeline's
  own aggregate, exactly as `scenarioExecution` is mounted on `scenarioRunId`.
  It resolves the enabled monitors, emits one intent per matched trace-level
  monitor, and settles immediately — no deadline, no residency. The promise
  lives from the inbox commit to the dispatch.
- **`threadIdleEvaluation`, keyed by `(projectId, monitorId, threadId)`.** The
  idle window spans multiple traces in one conversation, so it cannot live on a
  trace-keyed instance. `evaluationDispatch` records a match onto it by command,
  which is ADR-052's two-hop shape verbatim: subscriber-equivalent on the source
  pipeline sends IDs and timing config only, and the process keyed by the thing
  that actually waits holds `nextWakeAt`. Instance count tracks live
  conversations per thread-level monitor, and each settles when its window
  fires.

**What this costs, stated honestly.** A Postgres instance row plus one outbox row
per matched monitor, for every trace that matches at least one enabled monitor.
Not for every ingested trace: `dispatchEvaluations` returns before doing anything
when the project has no enabled ON_MESSAGE monitors, and that early return
survives the move. So the row count tracks *evaluated* traces — and an evaluated
trace already pays for an evaluator invocation, beside which a Postgres row and
its retention prune are not the expensive part. This is the number to watch on
the first conversion regardless, per ADR-075's own warning about steady-state row
count.

The `shouldReact` hazard ADR-075 names applies unchanged, and the origin guard
shows why. `passesTraceOriginGuards` has five clauses, and two of them — the
24-hour trace-age bound and the blocked-guardrail check — read fold state, which
`enqueue.filter` does not have. The prepared `_originGuardedSubscriber.ts` helper
already reflects this: its `when` predicate is event-only and it defers every
fold-state clause to the handler, where the reactor version could filter on fold
state before enqueueing. Moving `evaluationTrigger` therefore relocates two
guards rather than porting five.

### The durability floor, and what it means for the spec

One property bounds every substrate here, and it is better stated than
discovered later. **A GroupQueue job in flight when its worker is hard-killed is
not redelivered.** Dispatch removes the job from the group ZSET and its payload
from the data hash in a single Lua eval, so from that moment the payload exists
only in worker memory; on a crash the active key's TTL simply expires and
unblocks the group. Retry re-staging is real and thorough — handler failures,
exhausted attempts, drained siblings, transient blob-store faults all re-stage —
but a killed process is not one of those cases.

Every live-delivery path in this repo rides GroupQueue, so no substrate choice
removes that window. What the process manager changes is its *size*: for a
reactor or a subscriber the window spans the entire dispatch — the monitor
lookup and every enqueue after it — while for a process manager it ends at the
inbox commit, after which the outbox row is a Postgres fact and the dispatch is
owed.

So `evaluation-dispatch-durability.feature`'s first scenario — "A matching trace
is evaluated even if the worker restarts" — asks for something no substrate in
this ADR delivers in full. It should be bound to the window the process manager
actually closes, with the residual named in the file rather than left implied:
closing it entirely means either redelivering in-flight GroupQueue jobs or
reaching the dispatch decision from the event log by replay. Neither is decided
here, and both are larger than this ADR.

### Experiment runs: the leasable unit is a slice of cells, and a per-cell time bound is its precondition

**A whole run cannot be a leased message, and the reason is arithmetic.**
`OutboxDispatcherService` calls `leaseDueMessages({ leaseDurationMs })` once and
never renews — there is no keep-alive anywhere in that file. ADR-073 made
`scenarioExecution` safe by setting the lease above a *known* cap:
`CHILD_PROCESS.TIMEOUT_MS`, 15 minutes (`scenarios/scenario.constants.ts:36-39`).
Experiment runs have no such cap. The only timeout in `experiments-v3` is the
optional per-node `config.timeoutMs` in `workflowBuilder.ts:839`. A whole-run
lease therefore has no correct value: short enough to recover promptly from a
crash means a second worker re-leases a live run and re-executes work the
customer pays for; long enough for the worst legitimate run means a genuine
crash is unrecoverable for that same span. There is no setting that is right,
which is why the run is not the message.

**The cell is already a first-class object, and the orchestrator already treats
it as one.** `generateCells` flattens the run into a 1-D array of
`ExecutionCell` = (rowIndex, targetId, targetConfig, all evaluator configs,
dataset entry), and the Phase-1 dispatch loop walks it flat. The per-cell
workflow is *already* rebuilt inside `executeCell` from the cell alone, with a
nonce id. Results are already emitted per cell, per event, unbatched, straight
into `recordTargetResult` / `recordEvaluatorResult`. The event stream ADR-073
wanted to use as a heartbeat is per cell because the work is per cell.

**What decomposition actually costs — three things, and only one of them is
new.**

*Not a cost: per-cell resolution of providers and secrets.* `addEnvs` is already
called once for the target and again for **every evaluator** inside the cell,
each doing a project read, a secrets read and a per-secret decrypt, with no
memoisation. `getMatchingLLMModelCost` hits Prisma per priced result. Dispatching
cells to separate workers does not add this cost; it is already paid per cell,
and a warm per-worker cache would *reduce* it.

*A real cost: the loaded maps.* `loadExecutionData` resolves prompts, agents,
evaluators and workflows — full studio DSLs — with sequential per-target queries,
and the route hands the materialised maps straight to `runOrchestrator`
(`routes/experiments-v3.ts:459-470`). Serialising those into every cell message
is exactly the payload failure ADR-069 exists to prevent; re-loading them per
cell multiplies the queries by the cell count. **This is what makes the unit a
slice rather than a cell:** the dispatched message names a contiguous range of
cells, the worker resolves the loaded maps once per lease, and the lease is
bounded by (cells in slice × per-cell cap). Slice width is the single knob that
trades recovery latency against load amortisation, and it is a number rather
than a rewrite.

*A real cost, and genuinely sequential: the Phase-1 → Phase-2 reduce.*
Comparison, pairwise and select-best cells are generated from the union of
Phase-1 outputs and their sibling evaluator scores. This is a real barrier, not
an artifact — an accumulate-then-map. It is also the only one: the run-level
counters (`totalCost`, `completedCells`, `failedCells`) are commutative, and
ADR-072 already deleted their materialised form in favour of a `GROUP BY` over
`experiment_run_items`. **The reduce therefore has no state to carry.** Phase 2
becomes a second dispatch round the process manager arms when the last Phase-1
slice settles, and it reads its inputs from `experiment_run_items` — a
primary-key range scan on `(TenantId, RunId)`, which is the read path ADR-072
already built.

**The precondition is a per-cell execution cap.** Nothing may be leased whose
duration has not been bounded, and today no layer bounds a cell. This is one
constant and one enforcement point, and it must land before any leased dispatch
of experiment work — including the whole-run form ADR-073 sketched. It is also
independently worth having: a cell that hangs currently hangs a run forever with
no reaper.

**What stops being needed.** With cells dispatched and counters derived,
`runStateManager` has no remaining authority. It read-modify-writes the whole
run-state JSON per event into a 24-hour Redis key and keeps the last fifty
events; the run's real progress is in `experiment_run_items`. Removing it is what
makes `experiment-run-liveness.feature`'s "Recovery does not depend on a cached
progress record" true, rather than merely survivable. `abortManager` stays: ADR-073
already decided the Redis flag remains the in-flight signal, and per-slice
dispatch turns abort from a Redis GET per cell per event into one check per
lease.

### Interactive runs: the classifier is durability of the run definition, not attachment of a stream

ADR-073 keeps interactive SSE runs in-request and gives the reason as transport —
moving them "would mean rebuilding that transport on the broadcast service".
That reason is true and is not the binding one.

`POST /execute` builds the entire run definition from the request body: the
dataset (possibly inline rows), the targets, the evaluators, the parameters and
`seedTargetOutputs` (`routes/experiments-v3.ts:181-224`). This is unsaved
workbench state. It exists nowhere but in that HTTP request. There is nothing on
the fleet for a worker to read, so the blocker is not the stream — it is that the
run definition is not durable. Persisting it, not building a broadcast service,
is the enabling step, and it is the same step that would let an interactive run
survive a page reload.

So the classifier changes, and one entry point changes with it:

- **`POST /execute` stays in-request**, because its run definition is not
  durable. It still registers with the process manager and re-arms its deadline,
  exactly as ADR-073 decided, so an abandoned interactive run is recorded as
  failed.
- **`POST /:slug/run` dispatches to the fleet in both modes.** It runs from a
  persisted experiment, so its definition is durable in either mode. The SSE
  response follows the run's committed events rather than driving the generator
  in the request. This is not a reversal of ADR-073 — that ADR classified
  `/:slug/run` "in polling mode" and never classified the SSE mode of the same
  route, which today lets a CI client pin a long run to a web process by setting
  an `Accept` header.

### A declined evaluation is recorded where it is cheap and counted where it is not

Durability nobody can observe is indistinguishable from the bug it fixes, and
`ExecuteEvaluationCommand.handle` returns `[]` — no event whatsoever — on four
paths: sampling exclusion, unmet evaluator required fields, unmet preconditions,
and a service-reported skip. A monitor that declined and a monitor whose dispatch
was lost produce the same absence. That is the exact thing
`evaluation-dispatch-durability.feature` says must not be true.

The command's own comment explains why, and the reason is sound: emitting a
result per decline means a bulk re-evaluation over non-evaluatable traces writes
one per trace, each paying the heavy evaluation-projection read. So the spec
scenario as written — "the reason it was declined is available", per trace —
asks for something whose cost is proportional to trace volume. Either the cost or
the scenario has to give.

**The line is drawn at whether the platform spent anything.** A monitor that ran
an evaluator always reports, including when it failed; that is unchanged. A
monitor that declined before spending anything is counted per `(monitor,
reason)` and not written per trace. That satisfies the customer question actually
being asked — *why is this monitor producing nothing?* — at monitor granularity,
which is where the answer is actionable, and it does not turn a decline into a
write.

`evaluation-dispatch-durability.feature` is amended accordingly rather than left
to describe something the platform will not do. Its per-trace decline scenario
becomes a per-monitor one, and it gains a scenario for the case this ADR's first
section creates: a dispatch that had to be retried produces one evaluation, not
two.

### Sequencing

Interleaves with ADR-075's migration order rather than replacing it. Each step
is independently shippable and independently revertible.

1. **Derive the ids.** `evaluationTrigger` and the orchestrator's evaluation
   bridge stop minting KSUIDs. Behaviour-neutral under today's at-most-once
   dispatch, and a hard precondition for everything after it.
2. **`evaluationDispatch`, trace-keyed, trace-level monitors only.** This is
   ADR-075's migration step 2. Deletes the per-monitor swallowed catch and
   decouples dispatch retry from `traceSummary` re-application. Thread-level
   monitors keep the existing delayed-job path for one release, so the row-count
   effect of the first conversion is measured on its own.
3. **`threadIdleEvaluation`, thread-keyed.** The idle window moves out of Redis
   staging and becomes `nextWakeAt`. Ships after step 2 because it is the half
   whose instances have residency.
4. **Decline accounting**, with the spec amendment. Ships with or before step 2;
   without it, steps 2 and 3 are unobservable.
5. **A per-cell execution cap on experiment runs.** Precondition for anything
   leased. Worth shipping alone.
6. **ADR-073 step 2 for scenarios** — unchanged by this ADR, listed so the order
   is legible.
7. **Slice dispatch for `POST /:slug/run`**, both modes, with `runStateManager`
   deleted and Phase 2 armed by the process manager.
8. **Persist the workbench run definition**, which is what unblocks `/execute`.
   Explicitly out of scope here and needs no further decision: once the
   definition is durable, step 7 already covers it.

### What is deleted

`runStateManager` and its Redis run-state key; the per-monitor swallowed catch in
`dispatchEvaluations`; the random `evaluationId` mint at
`evaluationTrigger.reactor.ts:262` and its twin in the orchestrator; the
run-scoped accumulators in `runOrchestrator` that ADR-072 already made
unreadable. `abortManager` and `ExecuteEvaluationCommand` are untouched.

## Consequences

- Retrying a dispatch stops corrupting the thing the dispatch reads. Today the
  only retry available for a lost evaluation dispatch re-applies a
  non-idempotent fold whose counter suppresses evaluation.
- A monitor that silently fails to dispatch becomes a monitor whose dispatch is
  retried on its own job, and whose declines are counted rather than absent.
- A thread-idle wait survives a restart, at the cost of one process instance per
  live conversation per thread-level monitor.
- **Cost:** Postgres rows proportional to activity rather than to configuration,
  which is a first for this substrate. They are bounded by *evaluated* traces
  rather than ingested ones, and each sits beside an evaluator invocation that
  costs more, but this is the number that decides whether step 2 was a good idea
  and it should be instrumented before step 3.
- The window in which a hard kill loses a dispatch shrinks from the whole
  fan-out to the inbox commit. It does not close, and the spec now says so
  instead of implying otherwise.
- An experiment run becomes recoverable at slice granularity: a lost worker
  costs one slice, not one run, and the results already in
  `experiment_run_items` are already durable.
- Experiment runs gain a bound they have never had. A cell that hangs currently
  hangs its run indefinitely; after step 5 it fails its cell.
- Slice width becomes a real operational knob, and a wrong one is visible as
  either lease churn or slow recovery rather than as data loss.
- The Phase-1 → Phase-2 barrier survives decomposition as a second dispatch
  round rather than as retained state, because ADR-072 already moved the
  aggregates it would otherwise have had to carry.
- Two of the four entry points into experiment execution converge on one path;
  `/execute` remains the exception and is now the exception for a stated reason
  with a stated exit.
- **Cost:** derived ids mean an evaluation id is no longer time-ordered. Nothing
  decodes one — the only KSUID parsing in the repo is on event ids — but this is
  the same trade the suite-run derivation already made, and it is made here
  knowingly rather than by omission.
- **Cost:** counting declines instead of recording them per trace means a
  customer cannot ask "why was *this* trace not evaluated" and get an answer.
  That question is answerable today only for traces the platform already spent
  money on, so nothing is lost — but the spec has to stop promising it.

## References

- [`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature)
  — amended by this ADR in three places: per-trace decline visibility becomes
  per-monitor; "A matching trace is evaluated even if the worker restarts" is
  narrowed to the window the process manager actually closes, with the residual
  stated; and a scenario is added for a retried dispatch producing exactly one
  evaluation
- [`specs/experiments-v3/experiment-run-liveness.feature`](../../../specs/experiments-v3/experiment-run-liveness.feature)
  — needs scenarios for slice-granular recovery ("work already recorded is not
  repeated after the machine running it is lost") and for the run that reaches a
  terminal state without a cached progress record
- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
  — the substrate contract this ADR adds a question to; its "Work scheduled for
  later survives a restart" scenario is what the thread-idle window has to satisfy
- [`specs/monitors/evaluation-trigger-skips-derived-and-stale-traces.feature`](../../../specs/monitors/evaluation-trigger-skips-derived-and-stale-traces.feature)
  — the deliberate skips that must keep working when the guard moves handler-side
- [`specs/event-sourcing/payload-cost.feature`](../../../specs/event-sourcing/payload-cost.feature)
  — why the loaded maps make the unit a slice rather than a cell
- ADR-052 (automations on the process-manager substrate) — the precedent for a
  process keyed by something other than the source pipeline's aggregate
- ADR-069 (payload cost is a scheduling input) — the enqueue seam every
  conversion here lands on
- ADR-072 (run aggregates are queries) — deferred dispatch identity to ADR-073,
  and removed the accumulators that would otherwise have blocked decomposition
- ADR-073 (run execution on the process-manager substrate) — decides the
  substrate for both run types; this ADR decides the unit
- ADR-075 (post-event work is subscribers and process managers) — Class D, whose
  instance keying this ADR supplies and whose migration order it interleaves with
