# ADR-075: Post-event work is subscribers and process managers

- Status: Accepted — executed, with one carried item named below
- Date: 2026-07-28
- Amended: 2026-07-29 — see "Amendment: the fold-bound subscriber was
  withdrawn" under the Decision. The decision section as first written tells a
  reader to call a method that no longer exists.
- Supersedes: ADR-091 (reactor `shouldReact` predicate)
- Completes: ADR-052's deferred scope — *"`withReactor` remains available for
  the unrelated plain reactors. Migrating those reactors, scenario execution,
  Langy, topic clustering, caches, and observability are outside this
  decision."*
- Builds on: ADR-095 (best-effort vs stake-sensitive), ADR-035 (persist-class
  debounce), ADR-052 (automations on the process-manager substrate), ADR-069
  (payload cost — which shipped the enqueue seam every conversion here lands
  on), ADR-072, ADR-073

## Context

**This decision finishes something already begun, rather than opening it.**
ADR-095 drew the line in May 2026: reactors are acceptable for *best-effort*
work (it names "UI broadcasts, fold sync, cache invalidations") and
unacceptable for *stake-sensitive* work, "where a missed dispatch is either a
customer-trust violation or data loss". It observed that the framework "makes
no distinction between these two reactor classes" and that the default is
"best-effort with silent failure, which is the wrong default for half the
reactors we run."

ADR-095 then built `.withOutbox` for the stake-sensitive half. ADR-035
extended it so persist-class trigger actions rode the same staged path. ADR-052
replaced that machinery with the process-manager substrate, deleted
`.withOutbox`, moved the automation reactors to subscribers — and explicitly
left the rest for later, in the sentence quoted above.

This ADR is that "later". What it adds to ADR-095's split is the observation
that best-effort versus stake-sensitive is not the only axis: some reactors
write *derived state* rather than dispatching *work*, and for those the
question is not retry but reproducibility.

There are three ways to do work after an event today. Two of them are
deliberate — an **event subscriber** (event-only, carried through GroupQueue,
self-idempotent) and a **process manager** (transactional inbox, durable state,
deadlines, leased outbox). The third is the **reactor**: a side-effect handler
tied to a fold projection, dispatched after the fold applies and stores.

The reactor's defining property used to be stated in the router itself, as a
constant every dispatch site passed:

```ts
// projectionRouter.ts — deleted, see "What is deleted" below
// The router only ever dispatches reactors on the live event path — the
// replay service rebuilds fold projections and never invokes reactors, so
// no reactor context here can be a replay.
const LIVE_DISPATCH_IS_REPLAY = false;
```

`ReactorContext.isReplay` existed but was wired to that constant on every call
site and read by no handler — write-only plumbing, since removed. The property
it described still holds: a reactor sees live events only. Anything a reactor
writes is therefore **outside the event-sourced guarantee**: replay cannot
rebuild it, and any divergence between the event log and what the reactor
produced is permanent.

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
for automations: the `alertTrigger` / `evaluationAlertTrigger` reactors ADR-095
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

### Amendment: the fold-bound subscriber was withdrawn (2026-07-29)

> **`withSubscriber` no longer exists, and the two paragraphs above are the
> only part of this ADR that did not survive execution.** Do not follow them —
> code written against `withSubscriber({ fold, handler })` will not compile.
> They are kept because the reasoning they contain is still the reasoning a
> reader has to work through; what changed is the answer, not the question.
>
> **`withEventSubscriber` is the single surviving subscriber form.** The
> builder's whole surface is `withName`, `withAggregateType`,
> `withProjection`, `withFoldProjection`, `withMapProjection`,
> `withFeatureFlagService`, `withEventSubscriber`, `withProcessManager`,
> `withCommand` and `withCommandInstance`. There is no `withReactor`, no
> `withSubscriber`, and no `SubscriberSpec`. A subscriber's context is
> `{ tenantId, aggregateId }` and nothing else.
>
> **A handler that needs committed projection state takes a narrow read
> port.** One injected function with the smallest signature that answers the
> question — not the store, not the projection, not a widened event.
> `ee/governance/subscribers/traceAlertTriggerMatch.subscriber.ts` is the
> worked example: a `readTraceSummary` dep beside the handler's other
> collaborators.
>
> **The ordering consequence has to be stated plainly, because keeping the
> fold-bound form was how this ADR proposed to avoid it.** An event subscriber
> fires on delivery, not after a projection commits, so **the read races the
> fold**. The debounce window makes a committed row the overwhelmingly likely
> case, but that is a timing assumption, not an ordering guarantee — the fold
> lane is allowed to run behind.
>
> So **a miss is "we could not find out", never "there is nothing"**, and the
> handler must throw rather than return. The subscriber's own lane is the one
> seam here that retries: the queue re-leases a rejected job with backoff and
> parks its group once the budget is spent, so a genuinely unfoldable aggregate
> is visible and self-limiting. Returning would treat a race as an answer and
> drop the work silently and permanently — "the next event asks again" does not
> hold, because the dedup key usually covers the whole burst and the staged job
> is the only one that will ever run.
>
> This is exactly the trade the paragraphs above ruled out with "No injected
> store, no read-back port, no new event field." One of the three — the narrow
> read port — is what shipped, and the fail-loud rule above is the price of it.

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

> **Withdrawn 2026-07-29 — the answer is now the narrow read port.**
> `withSubscriber` was deleted rather than kept, so "no read-back port" is not
> what shipped: each of these handlers takes an injected read function for the
> state it used to get from `ctx.state`. The after-the-fold ordering is
> genuinely lost, which is why every such read must treat a miss as *unknown*
> and throw. See "Amendment: the fold-bound subscriber was withdrawn" above for
> the full rule.

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
the question entirely. **It no longer does — `withSubscriber` was withdrawn, so
the question has to be answered per site after all**, by a narrow read port
whose miss is treated as unknown. See the amendment above.

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

Two questions that come up during the conversion, both already answered by the
repo — settled here so they are not reopened:

**OCSF rows are keyed per span, not per trace.** Migration 00026's header is
explicit: *"Each governance span/log emits ONE OCSF row keyed by (TenantId,
EventId). EventId is the span_id (hex) for span-shaped traces and the log
record id for flat-event traces."* `folds.feature` says the same. The reactor
keyed on `traceId` and justified it in a docblock as "too noisy for SIEM
consumers" — that was a unilateral deviation from its own table's documented
contract, and it is also what made the stream un-rebuildable, since a trace is
not one immutable event. Restoring span grain is a bug fix, not a product
decision. SIEM volume is bounded by the export's cursor pagination and `limit`,
not by row grain, so the objection the docblock raised was already handled a
layer up.

**Log-record governance ingest has never worked, and this ADR does not fix it.**
Migration 00026 and `folds.feature` both provide for it, and the receiver does
stamp the origin attributes — but the trace pipeline only sees log attributes
through `liftCanonicalAttributesFromLogRecord`, whose extractor registry is a
set of *vendor* adapters (ClaudeCode, Codex, GenAI, SpringAI). `langwatch.origin.*`
is not a vendor attribute needing extraction; it is already canonical and
simply needs passing through. So webhook-ingested governance data produces no
KPI or OCSF rows and never has, under the reactor or after conversion. Scope
the projections to `span_received` to match real coverage. The gap is a genuine
defect on a compliance surface and deserves its own fix — but it is orthogonal
to which substrate writes the rows, and folding it in here would grow a
substrate change into an ingest change.

**Class D — work dispatch → process manager outbox (6).** `scenarioExecution`
(this is ADR-073 step 2), `evaluationTrigger`, `customEvaluationSync`,
`billingMeterDispatch`, `traceMetricsSync`, `simulationMetricsSync`. Each
dispatches work that must happen. `evaluationTrigger`'s per-monitor
`delay: monitor.threadIdleTimeout * 1000` and `simulationMetricsSync`'s
`delay: 60_000` become deadlines rather than queue delays.

**Class E — deferred re-check → process manager wake (1).** `originGate`
(`DEFERRED_CHECK_DELAY_MS`, 5 minutes) is a process manager written by hand:
its whole job happens *later*, so there is a deadline worth making durable.

**`projectMetadata` was in this class and does not belong here.** It has no
`delay` at all — its options are `makeJobId` + `ttl: 60_000`, which is a dedup
window, not a deferral. It runs immediately on the first event of each window,
so a process manager would buy a durable deadline it does not have, at the cost
of an instance row and an inbox transition per *trace* to do work that is
per *project*. The classification confused "debounced" with "deferred". Two
independent conversion attempts both refused the assignment before this was
corrected.

It is also two concerns fused, and the fusion was a live defect: the ADR-051
clustering bootstrap sat inside the metadata write's `try`, after a Prisma read,
so a database blip skipped the clustering re-assertion and reported it as
"Failed to update project metadata" — the clustering outage was invisible and
mislabelled. They split:

- the metadata write (`firstMessage` / `integrated` / `language`) reads three
  keys off `foldState.attributes`, so it is a **fold-bound subscriber**. Not a
  projection, for the same reason `virtualKey.lastUsedAt` is not: it is a side
  effect on a Prisma row with its own lifecycle, not derived state.
- the clustering bootstrap is a **liveness poke** and becomes its own
  subscriber, failing forward on a read error rather than skipping. Making it a
  process manager would be a process manager whose only job is to ensure another
  process manager exists — the durable deadline already exists one pipeline
  over, on the right key and cadence.

Longer term it should not ride the ingest path at all: a `.schedule()` sweep
inside the topic-clustering pipeline removes the coupling entirely. That is a
behaviour change and belongs in its own decision.

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
router's reactor dispatch path, and `specs/event-sourcing/reactors.feature`
(superseded by `post-event-work.feature`).

**Already deleted:** `LIVE_DISPATCH_IS_REPLAY` and the vestigial `isReplay`
plumbing are gone. They came out ahead of the rest because they were
write-only — the field was declared once, written as the constant at the three
router dispatch sites, and read by no handler anywhere — so removing them did
not require a single reactor call site to move. The invariant they documented
(replay never reaches a reactor) is unchanged and is recorded in this ADR
instead; it is the whole reason Class C exists. ADR-091 is superseded: `shouldReact`'s successor is
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
  (`folds.feature`).

- **`governance_kpis` is not an incrementing aggregate, and "recompute the
  bucket" would have been the wrong fix.** An earlier draft of this ADR said it
  was, and told implementers to recompute. Migration 00031 says otherwise:
  `ReplacingMergeTree(LastEventOccurredAt)` keyed
  `(TenantId, SourceId, HourBucket, TraceId)` — already one row per trace,
  summed at read time. Recomputing the bucket would have reintroduced the
  load-mutate-store race across traces sharing an hour that 00031's header
  explicitly rejected.

  The actual defect is narrower and worse: the version column is
  `LastEventOccurredAt`, which is the trace's *earliest* span start. It is
  **constant across firings**, so competing rows for one key tie and the
  survivor is arbitrary; and it can **decrease** when a span with an earlier
  start lands late, so a more complete row can lose to a less complete one.
  Rebuild-to-correct-drift could not have worked even in principle, because a
  replay writing final totals ties with what is already there. The fix is to
  move the key to event grain — one row per span, carrying that span's own
  cost — so re-derivation is a set-union of rows the set already contains.

- **This one was not merely un-rebuildable, it is wrong live, and it reaches a
  customer-facing alert.** `spendSpikeAnomalyEvaluator.service.ts` reads
  `sumIf(SpendUsd, …)` from `governance_kpis` with no `FINAL`, no `argMax` and
  no IN-tuple dedup, against a `ReplacingMergeTree` whose duplicate-keyed rows
  are exactly what the arbitrary-survivor tie produces. So the spend-spike rule
  over-counts every unmerged partial today. Event-grain keying removes the
  duplicate keys that cause it, but **the missing read-side dedup is a separate
  defect and should be fixed on its own** — it decides whether a customer gets
  paged.

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

- **The enqueue seam exists on one of three registration paths, and that blocks
  Classes C and E.** ADR-069 phase 1 put `EnqueueDispatchOptions` (filter +
  claim-check staging) on `EventSubscriberDefinition` only. The other two paths
  a retired reactor can land on have nothing:

  - `MapProjectionDefinition` has no equivalent, so a Class C conversion mints a
    job for every `span_received` — on the busiest path in the product — even
    when the derivation returns `null` for all but gateway spans. The subscriber
    half of the same conversion gets a filter and costs nothing; the projection
    half cannot.
  - `ProcessRuntime.registerPipeline` builds a process manager's subscriber as
    `{ name, eventTypes, handle }` with **no `options` object at all** — no
    dedup, no delay, no filter. So Class E is the largest row-count change in
    the whole retirement, not the mechanical tail it looks like. `originGate`
    today is `ttl: 15_000` + `delay: 5_000`, i.e. one job per trace per 15
    seconds. As a trace-keyed process manager it becomes a queue job, an inbox
    row and an optimistic-concurrency update on one instance row **per span** —
    a 10k-span trace goes from a handful of jobs to 10k durable Postgres
    transitions, serialised on a single key, with revision conflicts throwing
    back to the queue under contention. That is the amplification
    `specs/event-sourcing/hot-trace-fold-amplification.feature` exists for.

  Extending the seam to both paths is a router change touching all 15
  map-projection registrations and every process manager, which is why it is
  called out here rather than folded into a class. **It should land before the
  remaining Class C and Class E conversions, not after them.**

## References

- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
- [`specs/ai-gateway/governance/folds.feature`](../../../specs/ai-gateway/governance/folds.feature)
- [`specs/ai-gateway/governance/event-log-durability.feature`](../../../specs/ai-gateway/governance/event-log-durability.feature)
- [`specs/ai-gateway/budgets.feature`](../../../specs/ai-gateway/budgets.feature)
- [`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature)
- ADR-091 (reactor `shouldReact` predicate) — superseded
- ADR-095 (transactional outbox for stake-sensitive reactor dispatch) — where
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
