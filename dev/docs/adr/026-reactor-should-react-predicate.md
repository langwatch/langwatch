# ADR-026: Pure `shouldReact` predicate gates reactor enqueue

**Date:** 2026-06-10

**Status:** Accepted

## Context

Reactors are post-projection side-effect handlers. After a fold (or map)
projection applies and stores, `ProjectionRouter.dispatchToReactors`
enqueues **one GroupQueue job per reactor per event**. The trace-processing
pipeline registers ~9–13 reactors, so every span event becomes ~10 queue
jobs once its projection lands.

Most of those jobs do nothing. The relevance check lives at the top of
each reactor's `handle()` — `if (!scenarioRunId) return`,
`if (!isSpanReceivedEvent(event)) return`, `if (origin === "sample") return`
— so for a typical production span the simulation, experiment, origin-gate
and project-metadata reactors all pay the full enqueue → Redis write →
dequeue → deserialize → no-op cycle.

Under normal load this is waste; under recovery it is a hazard. When an
outage backs up the event log, draining the backlog multiplies every
deferred event by the reactor count, and the amplified job storm can
re-saturate the queue that just recovered.

The framework already has precedent for declarative pre-dispatch
filtering: map projections register with an `eventTypes` array. Reactors
never got an equivalent — `reactor.types.ts` explicitly documented
"Reactors fire on every fold completion (no eventTypes filter)".

A key enabler: the queue payload is `{ event, foldState }`, captured at
dispatch. The exact value a predicate sees at enqueue time is the value
`handle()` would later receive — there is no window in which the payload
can change between the two, so a decision made at dispatch cannot be
invalidated by execution-time drift.

See [specs/event-sourcing/reactors.feature](../../../specs/event-sourcing/reactors.feature)
for the behavioural contract this decision supports.

## Decision

We will add an optional **pure, stateless predicate** to
`ReactorDefinition`:

```ts
shouldReact?(event: E, context: ReactorContext<FoldState>): boolean;
```

`ProjectionRouter.dispatchToReactors` evaluates it once per reactor per
event, before enqueue (and before inline execution, so both modes behave
identically). `false` skips the reactor entirely — no job is created —
and increments `es_reactor_total{status="skipped"}` so the saved fan-out
is observable.

Constraints on the predicate, enforced by convention and review:

- **Pure and synchronous.** No IO, no injected dependencies, no promise.
  It may only inspect the event and fold state it is given (plus the
  clock for stale-trace cutoffs). This runs on the projection hot path;
  it must be cheap and must not introduce new failure modes there.
- **Fail open.** A thrown predicate is caught, logged, and treated as
  `true` — the job enqueues anyway. Worst case degrades to today's
  behaviour; a predicate bug can never silently drop a side effect.
- **Stateful guards stay in `handle()`.** Anything needing a DB lookup
  (project already integrated, experiment-ID resolution) is not eligible.
  A reactor whose relevance can only be decided with dependencies simply
  omits `shouldReact` and filters in the handler as before.

The event-intrinsic guards of these trace-pipeline reactors become
`shouldReact` predicates: `customEvaluationSync` (span-event type +
stale-trace cutoff + "span actually contains custom-evaluation events"),
`simulationMetricsSync` (`scenario.run_id` presence + has data to
aggregate), `experimentMetricsSync` (`evaluation.run_id` presence + has
cost), `originGate` (stale cutoff + origin already resolved),
`projectMetadata` (sample-origin seed traces).

Because the predicate fails open, a handler can still occasionally
receive an event its predicate would have rejected. Handlers therefore
keep their guards — the guard logic lives in a shared pure helper per
reactor, referenced by both `shouldReact` and `handle()`, so the two can
never drift.

## Rationale / Trade-offs

The alternative shapes considered:

- **Declarative `eventTypes` filter (mirror map projections).** Too
  coarse: most reactor guards are attribute- or fold-state-based
  (`scenario.run_id`, origin, cost presence), not event-type-based. A
  predicate subsumes the event-type case.
- **Batch/collapse jobs at the queue layer.** The existing
  `makeJobId` + `ttl` dedup already collapses redundant work *within* a
  reactor; it does nothing about the *cross-reactor* fan-out of jobs
  that will no-op. The two mechanisms are orthogonal and compose.
- **Run all reactors in one job.** Would couple unrelated side effects'
  retry/failure semantics and break per-reactor dedup, delay and
  kill-switch options.

The accepted trade-off is that predicate logic now executes inside
projection processing. We bound the risk by requiring purity (no new
dependencies on the hot path) and failing open (a predicate error costs
one log line and one redundant job, never a lost side effect or a failed
projection).

One subtlety: predicates that check `foldState` decide on the fold state
*as of dispatch*. Because the payload is immutable and `handle()`
receives that same snapshot, predicate and handler can never disagree.
A reactor must not use `shouldReact` to approximate a condition it
expects to be re-evaluated against *fresher* state at execution time —
that condition belongs in `handle()`.

## Consequences

- Typical production spans stop enqueuing jobs for the simulation,
  experiment, origin and project-metadata reactors — the bulk of the
  per-event reactor fan-out disappears for events that don't match.
- Backlog drains after an outage amplify by the number of *relevant*
  reactors, not the number of registered ones.
- `es_reactor_total{status="skipped"}` quantifies the savings and makes
  an over-aggressive predicate visible as an anomalous skip rate.
- Reactor unit tests gain a cheap, IO-free surface: predicate logic is
  testable without mocking dependencies.
- New reactors should default to providing `shouldReact` whenever their
  relevance is decidable from `(event, foldState)` alone.

## References

- Related ADRs: [ADR-023](./023-orphan-sweep-reactor-chain.md) (reactor
  infrastructure background; its orphan-sweep reactor was since removed,
  see [ADR-025](./025-remove-orphan-sweep.md)),
  [ADR-021](./021-lean-fold-cache.md) and
  [ADR-022](./022-event-log-source-of-truth.md) (fold-state caching —
  the `toCacheable` lean-cache hook must preserve every field the fold's
  `apply` reads, and reactors receive the post-apply state, so predicates
  reading `foldState.attributes` see the same values the handler does
  even on cache-rehydrated paths)
- Spec: [specs/event-sourcing/reactors.feature](../../../specs/event-sourcing/reactors.feature)
