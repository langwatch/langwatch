# ADR-075: Post-event work is subscribers and process managers

- Status: Proposed
- Date: 2026-07-28
- Supersedes: ADR-026 (reactor `shouldReact` predicate)
- Completes: ADR-052's deferred scope — *"`withReactor` remains available for
  the unrelated plain reactors. Migrating those reactors, scenario execution,
  Langy, topic clustering, caches, and observability are outside this
  decision."*
- Builds on: ADR-030 (best-effort vs stake-sensitive), ADR-035 (persist-class
  debounce), ADR-052 (automations on the process-manager substrate), ADR-069
  (payload cost — which shipped the enqueue seam every conversion here lands
  on), ADR-072, ADR-073

## Context

**This decision finishes something already begun, rather than opening it.**
ADR-030 drew the line in May 2026: reactors are acceptable for *best-effort*
work (it names "UI broadcasts, fold sync, cache invalidations") and
unacceptable for *stake-sensitive* work, "where a missed dispatch is either a
customer-trust violation or data loss". It observed that the framework "makes
no distinction between these two reactor classes" and that the default is
"best-effort with silent failure, which is the wrong default for half the
reactors we run."

ADR-030 then built `.withOutbox` for the stake-sensitive half. ADR-035
extended it so persist-class trigger actions rode the same staged path. ADR-052
replaced that machinery with the process-manager substrate, deleted
`.withOutbox`, moved the automation reactors to subscribers — and explicitly
left the rest for later, in the sentence quoted above.

This ADR is that "later". What it adds to ADR-030's split is the observation
that best-effort versus stake-sensitive is not the only axis: some reactors
write *derived state* rather than dispatching *work*, and for those the
question is not retry but reproducibility.

There are three ways to do work after an event today. Two of them are
deliberate — an **event subscriber** (event-only, carried through GroupQueue,
self-idempotent) and a **process manager** (transactional inbox, durable state,
deadlines, leased outbox). The third is the **reactor**: a side-effect handler
tied to a fold projection, dispatched after the fold applies and stores.

The reactor's defining property is stated in the router itself:

```ts
// projectionRouter.ts
// The router only ever dispatches reactors on the live event path — the
// replay service rebuilds fold projections and never invokes reactors, so
// no reactor context here can be a replay.
const LIVE_DISPATCH_IS_REPLAY = false;
```

`ReactorContext.isReplay` exists but is wired to that constant on every call
site. A reactor sees live events only. Anything a reactor writes is therefore
**outside the event-sourced guarantee**: replay cannot rebuild it, and any
divergence between the event log and what the reactor produced is permanent.

ADR-072 removed two aggregates that had exactly this bug. `suite_runs` was
maintained by `suiteRunSync.reactor.ts` with non-idempotent `+ 1` counters on
at-least-once delivery, a handler that swallowed failures as "non-fatal", and no
way to rebuild — so it drifted up on redelivery, down on drops, and stayed
drifted. It moved user-visible status while doing it.

That was not a bad reactor. That is what a reactor is. The same shape is still
in production on surfaces where the consequences are worse than a wrong count on
a page nobody opened:

- **`gatewayBudgetSync`** writes budget debit rows to ClickHouse
  (`budgetCHRepository.insertDebit`) and emits the `BUDGET_UPDATED` change event
  the Go gateway consumes to evict cached bundles. A dropped invocation means
  spend the gateway never learns about, against a budget whose purpose is to
  stop spend.
- **`governanceOcsfEventsSync`** writes the OCSF audit event stream
  (`governanceOcsfEventsRepository.insertEvent`). Two compliance specs asserted
  the opposite of this: `folds.feature` called both governance streams "fold
  projections … rebuildable at any time from the append-only event_log", and
  `event-log-durability.feature` carried a `Rule: folds and reads are
  rebuildable from event_log`. **No fold projection exists for either stream** —
  there is a reactor and a repository. Every scenario in `folds.feature` was
  also untagged, so none of it was enforced and the discrepancy went unnoticed.
  Both files are corrected as part of this change: the rebuild scenarios are
  retained and marked `@unimplemented`, because they are precisely the contract
  Class C has to satisfy, and an auditor has already been told they hold.
- **`billingMeterDispatch`** dispatches billing meter reads.

Beyond correctness, reactors have grown private reimplementations of what the
process-manager substrate already provides. `ReactorOptions.ttl` is a dedup
window; the transactional inbox does dedup properly. `ReactorOptions.delay` is a
timer; `nextWakeAt` is a durable deadline. `originGate.reactor.ts` hardcodes
`DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000` and calls `scheduleDeferred` — that is
a process manager, hand-rolled, with its timer living wherever the queue happens
to keep it.

Three substrates for one concern also means three places to fix anything: three
retry stories, three dedup stories, three observability stories.

None of this is speculative. ADR-052 already carried out the same conversion
for automations: the `alertTrigger` / `evaluationAlertTrigger` reactors ADR-030
was written about are now `traceAlertTriggerMatch.subscriber.ts` and
`evaluationAlertTriggerMatch.subscriber.ts`. `_originGuardedReactor.ts` and
`_originGuardedSubscriber.ts` still sit side by side, single-sourcing their
shared guard, because during that migration the same logic had to be expressed
both ways. What remains is the set ADR-052 listed and postponed.

See the behavioural contracts this decision supports:
[`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
(the substrate contract),
[`specs/ai-gateway/governance/folds.feature`](../../../specs/ai-gateway/governance/folds.feature)
and
[`event-log-durability.feature`](../../../specs/ai-gateway/governance/event-log-durability.feature)
(Class C's rebuild contract — both corrected in this change, see below),
[`specs/ai-gateway/budgets.feature`](../../../specs/ai-gateway/budgets.feature)
("spend must survive the thing that recorded it"), and
[`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature).

## Decision

**The reactor is retired as a concept.** Post-event work is expressed as a
subscriber or a process manager, and nothing else. `ReactorDefinition`,
`ReactorContext`, `ReactorOptions`, `withReactor` and the router's reactor
dispatch path are deleted once the last call site moves.

**There are two kinds of subscriber, and the distinction is load-bearing.**
An earlier draft of this ADR described a subscriber as event-only, with no fold
state — that is true of one of them and not the other, and the omission
actively misled the first two conversions, which each invented a way to fetch
committed state that the framework already provides:

- **`withEventSubscriber(name, def)`** takes an `EventSubscriberDefinition`.
  It sees the event and nothing else (`EventSubscriberContext` is `tenantId` +
  `aggregateId`), and is dispatched from the routing seam independent of any
  projection.
- **`withSubscriber(name, { fold: "...", handler })`** takes a `SubscriberSpec`
  and stages the handler *after that projection commits the event*, with the
  committed state in `ctx.state: TriggerContext<FoldState>`. Its own docblock
  calls it "the best-effort reaction primitive (ADR-052)". This is the direct
  replacement for a reactor: same after-the-fold ordering, same fold state, and
  it is what the automations migration already used.

**Pick the fold-bound form whenever the handler reads `context.foldState`
today.** It preserves both the state and the ordering, which the event-only
form silently drops — a reactor fires after its projection commits, an event
subscriber fires on delivery. Reach for `withEventSubscriber` only where the
handler genuinely needs nothing but the event.

Given that, the choice is decided by one question — *if this work is lost, does
anything need to be able to tell?*

| If the work… | Substrate | Guarantee |
| --- | --- | --- |
| pushes a notification to whoever is connected right now | **subscriber** | at-most-once, explicitly. A lost push is invisible by the next refetch |
| calls a third party where loss is acceptable by contract | **subscriber** | debounced, at-least-once, no durable trace |
| produces state someone later reads as fact | **projection** | rebuilt by replay from the event log |
| dispatches work that costs money or must happen | **process manager** | leased outbox, retried up to the process's own `maxAttempts` |
| happens *later* rather than *now* | **process manager** | `nextWakeAt`, a durable deadline |

A projection is not a further substrate — it is the existing fold/map projection
machinery, which replay already rebuilds. The point of the row is that derived
state must go through it rather than through a handler beside it.

### The eighteen call sites

Counted by live `.withReactor(...)` registration, which is the only honest way
to count them: an earlier draft of this ADR said seventeen, because it searched
for `*.reactor.ts` and `snapshotUpdateBroadcast.ts` does not carry the suffix.
There are **19 registrations, 18 of them real** — see `retentionOrphanSweep`
under "What is deleted".

**Class A — transient fan-out → subscriber (4).** `cancellationBroadcast`,
`spanStorageBroadcast`, `traceUpdateBroadcast`, `snapshotUpdateBroadcast`.
These push to websocket/SSE clients. Making them durable would be *wrong*: an
outbox redelivering a push to a browser that closed an hour ago is not a fix,
it is a leak. They become subscribers with at-most-once semantics stated in the
spec rather than implied by a `ttl`.

Class A looked mechanical and is not, for a reason that generalises across
every class: **most of these handlers read `context.foldState`.**
`cancellationBroadcast` labels its message with `BatchRunId`, which the
`cancel_requested` event does not carry — it only ever enters the fold from
`queued`/`started`. `snapshotUpdateBroadcast` has the same dependency four times
over (`ScenarioRunId`, `BatchRunId`, `ScenarioSetId`, `Status`).

**The answer is the fold-bound subscriber**, `withSubscriber({ fold, handler })`,
which hands the committed state to the handler in `ctx.state` and preserves the
after-the-fold ordering. No injected store, no read-back port, no new event
field. Two independent conversion attempts each reached for a workaround here
before the ADR named the right seam; that was the ADR's fault, not theirs.

Where a field turns out to have no reader at all, delete it instead of carrying
it across — `CancellationMessage.batchRunId` and `.projectId` have no consumer
(`scenario.processor.ts` reads only `scenarioRunId`). A field nobody reads is
not a migration problem, it is dead weight the conversion happens to expose.

**Ordering is the other reason to prefer the fold-bound form.** A reactor fires
after its parent projection applies *and stores*; `withEventSubscriber` is
dispatched from the routing seam, independent of any projection. Converting to
the event-only form silently changes `spanStorageBroadcast` from "the span is in
ClickHouse" to "something happened on this trace". That happens to be tolerable
where the client refetches rather than trusting the push — but it is a semantic
change to check per site, never to assume, and `withSubscriber({ fold })` avoids
the question entirely.

**Class B — external CRM sync → subscriber (3).** `customerIoEvaluationSync`,
`customerIoSimulationSync`, `customerIoTraceSync`, all on
`CIO_REACTOR_DEBOUNCE_TTL_MS`. Marketing nurture counts, lossy by contract.
Subscribers, keeping the debounce as a deduplication strategy — and the two
that read fold state (`customerIoTraceSync` needs the trace's accumulated sdk
attributes and its business `occurredAt`; `customerIoEvaluationSync` needs
`evaluatorType`, which only the `reported` event carries) take the fold-bound
form.

**None of the three is registered.** `createCustomerIo*Reactor` has no call
site outside its own file and its own unit test, and `pipelineRegistry.ts`
carries a TODO saying the counting strategy has to be settled before enabling
them. The `evaluationCountFn` / `simulationCountFn` they depend on do not exist
anywhere in the repo. So Class B is not live code with a migration problem — it
is **three unwired reactors and a missing feature**. Converting them is cheap
and keeps the retirement total, but it does not remove anything from production,
and the honest sequencing choice is either to finish the counting work or to
delete all three. That decision belongs to whoever owns nurture, not to this
ADR; what this ADR insists on is that they must not be left as a fourth kind of
post-event handler.

**Class C — derived durable state → projection (3).** `gatewayBudgetSync`,
`governanceKpisSync`, `governanceOcsfEventsSync`. All three write derived rows
to ClickHouse that someone reads as fact. All three become projections, so
replay rebuilds them and drift stops being permanent. `gatewayBudgetSync`
splits: the debit rows are the projection, and the best-effort
`virtualKey.lastUsedAt` touch is a subscriber, because it is a side effect on
Prisma rather than derived state.

**Class D — work dispatch → process manager outbox (6).** `scenarioExecution`
(this is ADR-073 step 2), `evaluationTrigger`, `customEvaluationSync`,
`billingMeterDispatch`, `traceMetricsSync`, `simulationMetricsSync`. Each
dispatches work that must happen. `evaluationTrigger`'s per-monitor
`delay: monitor.threadIdleTimeout * 1000` and `simulationMetricsSync`'s
`delay: 60_000` become deadlines rather than queue delays.

**Class E — deferred re-check → process manager wake (2).** `originGate`
(`DEFERRED_CHECK_DELAY_MS`, 5 minutes) and `projectMetadata` (which also owns
the ADR-051 topic-clustering bootstrap). Both are already process managers
written by hand.

### Migration order

Ordered by consequence-of-loss, not by ease:

1. **Class C** — money and audit. `gatewayBudgetSync` and
   `governanceOcsfEventsSync` first; these are the two where the current
   behaviour is arguably a defect rather than a design choice.
2. **Class D, billing and evaluation** — `billingMeterDispatch`,
   `evaluationTrigger`, `customEvaluationSync`. A silently skipped evaluation is
   a customer-visible miss with no error anywhere.
3. **Class D, `scenarioExecution`** — ADR-073 step 2, unchanged by this ADR.
4. **Class E** — mechanical, and each removes a hand-rolled timer.
5. **Classes A and B** — mechanical, lowest risk, and the point at which
   `ReactorDefinition` can be deleted.

Each step is independently shippable and independently revertible. Nothing here
requires a big-bang cutover, and no step depends on a later one.

### What is deleted

`ReactorDefinition`, `ReactorContext`, `ReactorOptions`, `withReactor`, the
router's reactor dispatch path, `LIVE_DISPATCH_IS_REPLAY` and the vestigial
`isReplay` plumbing, and `specs/event-sourcing/reactors.feature` (superseded by
`post-event-work.feature`). ADR-026 is superseded: `shouldReact`'s successor is
`EnqueueDispatchOptions.filter` on the event-only subscriber contract (ADR-069
phase 1) or the fold-bound subscriber's trigger predicate, plus the process
manager's.

**`retentionOrphanSweep` goes with them, and is not migrated.** It is declared
as an optional dep in `trace-processing/pipeline.ts` and registered when
supplied — but nothing in `langwatch/src` or `langwatch/ee` ever supplies it. It
is dead wiring, which is why the registration count is 19 while the live call
sites are 18. Delete the dep and its `if` block rather than finding it a class.

### The one migration hazard: `shouldReact` fails open, `filter` does not

These two predicates look interchangeable and are not. The difference is what
a *throw* means, and it is inverted:

| | on throw |
| --- | --- |
| `shouldReact` (reactor) | caught, logged, **treated as `true`** — "fail open — never drops a side effect" |
| `enqueue.filter` (subscriber, ADR-069) | reported as a dispatch failure and **the job is permanently lost** — routing has no retry |

ADR-069 chose that deliberately: the enqueue seam runs in the routing worker
with no retry behind it, so it "takes only cheap, total predicates" and a throw
must be loud rather than silently indistinguishable from "not relevant".
`reactors.feature` pins the opposite property — *"A failing relevance check
never drops a side effect"*.

So a literal `shouldReact` → `filter` port converts *fail-open* into
*fail-lost*. For Classes A and B that is acceptable; those are at-most-once by
design. For Class D it is not, and `evaluationTrigger` is the sharp case: its
guard is 393 lines of monitor matching, and losing its job silently is exactly
the failure `specs/monitors/evaluation-dispatch-durability.feature` says must
not happen.

**The rule for Class C, D and E conversions:** only the total, non-throwing
part of a `shouldReact` predicate may move to `enqueue.filter` — a set lookup,
a `typeof` check, a field comparison. Anything data-dependent or fallible stays
in the handler, where a failure retries that job instead of dropping it. Where
a guard cannot be split that way, it moves wholesale into the handler and the
enqueue filter narrows on `eventTypes` alone.

## Consequences

- Derived state is rebuildable by replay, everywhere. The `suite_runs` failure
  mode stops being reachable rather than being fixed one site at a time.
- The compliance claim in `event-log-durability.feature` becomes true for the
  governance streams that currently contradict it.
- Spend stops being lost to a handler that happened to throw — but by two
  different routes, and the difference matters. Budget debits are Class C: they
  become a projection, so a lost debit is recovered by rebuilding the window
  from the event log, not by an outbox retry. Billing *dispatch* is Class D and
  is what gains the outbox. Reading the debit guarantee as "retry" would be
  reading the wrong mechanism, and would go looking for outbox rows that a
  projection never writes.
- One dedup story and one deferral story instead of `ttl`/`delay` beside inbox
  and `nextWakeAt`.
- Two substrates to learn, and to instrument, rather than three.
- **Cost:** more Postgres rows. Class C and D sites gain
  `ProcessManagerInstance` / `ProcessManagerOutbox` rows where they previously
  had a queue job and nothing else. The retention path from ADR-052 already
  prunes dispatched rows, but the steady-state row count goes up and should be
  watched on the first Class D conversion.
- **Cost:** Class A loses its implicit retry. That is intended — these are
  at-most-once pushes and the frontend refetches — but it is a real change and
  the spec must say so, because today the behaviour is an accident of the queue
  rather than a decision.
- Projection conversion in Class C changes *when* rows appear: a projection is
  rebuilt on replay, so a replay over a governance window will re-derive the
  OCSF and KPI streams. Each repository must therefore be idempotent on its own
  natural event key **before** conversion — this is a precondition, not a
  consequence. OCSF rows carry the span id or log-record id as `event_id`
  (`folds.feature`). `governance_kpis` needs work: it is an incrementing
  aggregate per `(org, source, hour_bucket)`, so re-deriving means recomputing
  the bucket rather than re-applying a delta.

- **Do not delete the budget ledger's insert probe.** An earlier draft of this
  ADR said the ledger "collapses on `(TenantId, BudgetId, GatewayRequestId)`
  via `ReplacingMergeTree`", implying the table engine makes replay safe. It
  does not, and acting on that sentence would inflate every budget. The engine
  is right for the ledger table (`00017_create_gateway_budget_ledger.sql`), but
  budgets are **enforced on `gateway_budget_scope_totals`** — an
  `AggregatingMergeTree` fed by a materialised view that `sumState`s at INSERT
  time. A materialised view fires per insert, so a duplicate ledger insert adds
  a second contribution to the sum, and collapsing the ledger row afterwards
  does not retract it. The inflation is immediate and permanent.

  What actually keeps spend honest is application code: `insertDebit` probes
  `SELECT 1 … WHERE TenantId AND GatewayRequestId LIMIT 1` before inserting, and
  skips on a hit. Any Class C conversion must preserve that probe, and it is the
  kind of code someone deletes as redundant precisely *because* the table says
  `ReplacingMergeTree`.

  The probe is also weaker than it looks: it keys on `gateway_request_id` alone,
  not `(budget, request)`. A request whose debit landed for two of three budgets
  finds a row, skips, and keeps the gap forever — so replay repairs a *wholly*
  missing debit and not a partial one. `budgets.feature`'s "any debit missing
  from the ledger is reported" is therefore not satisfied by conversion alone.
  Widening the probe is a one-line `WHERE` change and should ship with it.

- **Map projections have no enqueue filter, and Class C needs one.** ADR-069
  phase 1 put `EnqueueDispatchOptions` on the *subscriber* contract only;
  `MapProjectionDefinition` has no equivalent. So a Class C conversion that
  lands as a map projection mints a job for every `span_received` event — on the
  busiest path in the product — even when the derivation returns `null` for all
  but gateway spans. The subscriber half of the same conversion gets a filter
  and costs nothing; the projection half cannot. Giving `MapProjectionDefinition`
  the same seam, applied in `dispatchToMapProjections`, should land **before**
  the remaining Class C conversions rather than after them. It is a router
  change affecting all 15 map-projection registrations, which is why it is
  called out here rather than folded into a class.

## References

- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
- [`specs/ai-gateway/governance/folds.feature`](../../../specs/ai-gateway/governance/folds.feature)
- [`specs/ai-gateway/governance/event-log-durability.feature`](../../../specs/ai-gateway/governance/event-log-durability.feature)
- [`specs/ai-gateway/budgets.feature`](../../../specs/ai-gateway/budgets.feature)
- [`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature)
- ADR-026 (reactor `shouldReact` predicate) — superseded
- ADR-030 (transactional outbox for stake-sensitive reactor dispatch) — where
  best-effort vs stake-sensitive was first drawn
- ADR-035 (persist-class actions ride the settle stage) — the precedent for
  moving a reactor's dispatch onto a durable staged path
- ADR-049 (Langy projection-independent reactions) — the same move, made first
  for one pipeline: reactions stop receiving a captured read projection as if it
  were durable process state
- ADR-052 (automations on the process-manager substrate) — the inbox/outbox
  precedent, and the decision that deferred this one
- ADR-069 (payload cost is a scheduling input) — phase 1 shipped
  `EnqueueDispatchOptions` on the subscriber contract, so every conversion here
  inherits its enqueue seam *and* its fail-lost throw semantics. Its doctrine
  ("an irrelevant event costs nothing, a relevant one waits at the cost of a
  pointer") is also the general form of the `toPayload` narrowing ADR-073's
  `scenarioExecution` process does by hand
- [`specs/event-sourcing/payload-cost.feature`](../../../specs/event-sourcing/payload-cost.feature)
  — the enqueue seam's own contract; `post-event-work.feature` deliberately
  does not restate it and covers the substrate choice instead
- ADR-072 (run aggregates are queries, not pipelines) — the `suite_runs` failure
- ADR-073 (run execution on the process-manager substrate) — Class D's
  `scenarioExecution` is its step 2
- `src/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedSubscriber.ts`
  (the in-repo reactor/subscriber pair)
