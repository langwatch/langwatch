# ADR-075: Post-event work is subscribers and process managers

- Status: proposed
- Date: 2026-07-28
- Supersedes: ADR-026 (reactor `shouldReact` predicate)
- Builds on: ADR-052 (automations on the process-manager substrate), ADR-072,
  ADR-073

## Context

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
  (`governanceOcsfEventsRepository.insertEvent`). Meanwhile
  `specs/ai-gateway/governance/event-log-durability.feature` tells auditors that
  "folds and read projections are derived from those events; the source of truth
  is the event log". For this stream that is not true — it is derived by a
  handler replay does not run, so it cannot be rebuilt from the event log it
  claims to derive from.
- **`billingMeterDispatch`** dispatches billing meter reads.

Beyond correctness, reactors have grown private reimplementations of what the
process-manager substrate already provides. `ReactorOptions.ttl` is a dedup
window; the transactional inbox does dedup properly. `ReactorOptions.delay` is a
timer; `nextWakeAt` is a durable deadline. `originGate.reactor.ts` hardcodes
`DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000` and calls `scheduleDeferred` — that is
a process manager, hand-rolled, with its timer living wherever the queue happens
to keep it.

Three substrates for one concern also means three places to fix anything: three
retry stories, three dedup stories, three observability stories. The precedent
for collapsing them already exists in-repo — `_originGuardedReactor.ts` and
`_originGuardedSubscriber.ts` sit side by side today, single-sourcing their
shared guard, because the same logic already had to be expressed both ways.

See the behavioural contracts this decision supports:
[`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature),
[`specs/ai-gateway/governance/derived-governance-streams.feature`](../../../specs/ai-gateway/governance/derived-governance-streams.feature),
[`specs/ai-gateway/budget-debit-durability.feature`](../../../specs/ai-gateway/budget-debit-durability.feature),
[`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature).

## Decision

**The reactor is retired as a concept.** Post-event work is expressed as an
event subscriber or a process manager, and nothing else. `ReactorDefinition`,
`ReactorContext`, `ReactorOptions`, `withReactor` and the router's reactor
dispatch path are deleted once the last call site moves.

The choice between the two is decided by one question — *if this work is lost,
does anything need to be able to tell?*

| If the work… | Substrate | Guarantee |
| --- | --- | --- |
| pushes a notification to whoever is connected right now | **subscriber** | at-most-once, explicitly. A lost push is invisible by the next refetch |
| calls a third party where loss is acceptable by contract | **subscriber** | debounced, at-least-once, no durable trace |
| produces state someone later reads as fact | **projection** | rebuilt by replay from the event log |
| dispatches work that costs money or must happen | **process manager** | leased outbox, retried until it succeeds |
| happens *later* rather than *now* | **process manager** | `nextWakeAt`, a durable deadline |

A projection is not a third substrate — it is the existing fold/map projection
machinery, which replay already rebuilds. The point of the row is that derived
state must go through it rather than through a handler beside it.

### The seventeen call sites

**Class A — transient fan-out → subscriber (3).** `cancellationBroadcast`,
`spanStorageBroadcast`, `traceUpdateBroadcast`. These push to websocket/SSE
clients. Making them durable would be *wrong*: an outbox redelivering a push to
a browser that closed an hour ago is not a fix, it is a leak. They become
subscribers with at-most-once semantics stated in the spec rather than implied
by a `ttl`.

**Class B — external CRM sync → subscriber (3).** `customerIoEvaluationSync`,
`customerIoSimulationSync`, `customerIoTraceSync`, all on
`CIO_REACTOR_DEBOUNCE_TTL_MS`. Marketing nurture counts, lossy by contract.
Subscribers, keeping the debounce as a deduplication strategy.

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
`post-event-work.feature`). ADR-026 is superseded: `shouldReact` becomes the
subscriber's `eventTypes` filter and the process manager's trigger predicate,
both of which already exist.

## Consequences

- Derived state is rebuildable by replay, everywhere. The `suite_runs` failure
  mode stops being reachable rather than being fixed one site at a time.
- The compliance claim in `event-log-durability.feature` becomes true for the
  governance streams that currently contradict it.
- Budget debits and billing dispatch get the outbox's retry, so spend is not
  lost to a handler that happened to throw.
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
  OCSF and KPI streams. The repositories must therefore be idempotent on
  `(tenantId, eventId)`, which is a precondition of the conversion rather than a
  consequence of it.

## References

- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
- [`specs/ai-gateway/governance/derived-governance-streams.feature`](../../../specs/ai-gateway/governance/derived-governance-streams.feature)
- [`specs/ai-gateway/budget-debit-durability.feature`](../../../specs/ai-gateway/budget-debit-durability.feature)
- [`specs/monitors/evaluation-dispatch-durability.feature`](../../../specs/monitors/evaluation-dispatch-durability.feature)
- ADR-026 (reactor `shouldReact` predicate) — superseded
- ADR-052 (automations on the process-manager substrate) — the inbox/outbox
  precedent
- ADR-072 (run aggregates are queries, not pipelines) — the `suite_runs` failure
- ADR-073 (run execution on the process-manager substrate) — Class D's
  `scenarioExecution` is its step 2
- `src/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedSubscriber.ts`
  (the in-repo reactor/subscriber pair)
