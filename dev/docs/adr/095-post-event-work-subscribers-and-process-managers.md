# ADR-095: Post-event work is subscribers and process managers; the reactor vocabulary is retired

**Date:** 2026-08-13

**Status:** Accepted

**Supersedes:** [ADR-026](./026-reactor-should-react-predicate.md) (the `shouldReact` contract carries over to subscribers as the `when` guard).

**Relates to:** [ADR-052](./052-automations-on-process-manager-substrate.md) (the subscriber sugar and process-manager substrate this completes), [ADR-069](./069-payload-cost-doctrine.md) (why pre-enqueue rejection matters), [ADR-049](./049-langy-projection-independent-reactions.md).

**Behavioural contract:** [specs/event-sourcing/post-event-work.feature](../../../specs/event-sourcing/post-event-work.feature), superseding `specs/event-sourcing/reactors.feature`.

## Context

The event-sourcing layer has had three names for post-event work: reactors
(`.withReactor`), subscribers (`.withSubscriber`, ADR-052), and process
managers (`.withProcessManager`, ADR-049/052). Two of those names are the same
machine. A fold- or map-bound subscriber is compiled by the pipeline builder
into the identical internal registration a reactor gets — the same
`foldReactors` map, the same queue job path
(`fold/<projection>/reactor/<name>`), the same dedup, delay, group-key and
fail-open guard semantics. The only real differences are vocabulary and
authoring shape: a reactor is an object with `handle` and `shouldReact`
authored in its own `*.reactor.ts` file and injected as a dependency; a
subscriber is a declaration in the pipeline definition with a handler function
injected as a dependency.

Having two names for one thing has been actively misleading, in both
directions:

- The name "reactor" suggests a durability class that does not exist. Reactors
  are excluded from replay (`projectionRouter.ts` pins
  `isReplay = false` on live dispatch and the replay service never invokes
  them), so anything a reactor writes cannot be rebuilt from the event log.
  They are best-effort: durable and retried only from the moment their job is
  staged onto the GroupQueue, and silently lost if the process dies between
  fold commit and staging.
- Meanwhile the subscriber docs undersell what the shared machinery gives
  both: pre-enqueue relevance rejection (an irrelevant event never pays
  serialization — ADR-069), queue-level dedup and debounce windows, throttles
  (`throttledPerWindow`), custom group keys for lane control, and at-least-once
  redelivery after staging.

The distinction that actually matters is not reactor-versus-subscriber; it is
best-effort versus stake-sensitive. That line is already drawn: process
managers own the stake-sensitive side, with durable per-key state, an
exactly-once consumption inbox (`ProcessManagerInbox`), a transactional outbox
with lease/retry/attempt-cap dispatch, and wake scheduling. Thirteen process
managers across nine pipelines run on that substrate today, including the
spend-settlement and governance-events processes that replaced earlier
reactors.

A previous attempt to retire reactors (#6051, stacked under #6307, retried as
#6406) coupled the retirement to a full substrate rewrite and died of its own
diff size. Nothing about the retirement itself needs a new substrate.

At the point of this decision the tree had 21 reactor registrations across the
trace, simulation, evaluation, coding-agent and global-projection surfaces —
three of them (the Customer.io sync trio) implemented but never registered on
any pipeline, waiting on a counting strategy that never landed.

## Decision

We retire the reactor as a public concept. Post-event work has exactly two
primitives:

```
                         event committed to the log
                                   │
                     fold / map projection applies + stores
                                   │
              ┌────────────────────┴────────────────────┐
              │                                         │
      .withSubscriber(...)                   .withProcessManager(...)
      best-effort side effects               stake-sensitive orchestration
              │                                         │
   pre-enqueue `when` guard                   exactly-once inbox row
   (total, non-throwing parts;                          │
    fail-open on throw)                       pure handlers evolve state
              │                                against durable process rows
   GroupQueue job: delay / dedup /                      │
   throttle window / group key                intents → transactional outbox
              │                               (lease, retry ladder, attempt cap)
   handler (at-least-once after                         │
   staging; lost if never staged;             executor performs the work;
   never replayed)                            `nextWakeAt` re-enters later
```

Concretely:

1. **Every reactor converts one-to-one into a subscriber**, keeping its
   registration name and its queue options. The name is load-bearing: the
   queue job path is derived from the registration name regardless of which
   builder method created it, so jobs staged by pods running the old code
   dispatch into the new registration after a rolling deploy. Delay, dedup
   TTL, dedup strategy, group key and throttle windows carry over through
   `TriggerOptions`; `throttledPerWindow` moves with them as a trigger-spec
   helper. Handlers move from `*.reactor.ts` objects to handler factories in
   `subscribers/` modules, injected through the same pipeline deps.
2. **`shouldReact` becomes `when`.** The contract is unchanged from ADR-026:
   pure, synchronous, evaluated before enqueue, and fail-open — a throwing
   guard is logged and treated as relevant, never dropping a side effect.
   Guards that need dependencies stay in the handler.
3. **The public reactor surface is deleted**, not aliased: `.withReactor`,
   the `ReactorDefinition` authoring type, and the `*.reactor.ts` files go.
   The internal dispatch machinery — which was always the subscriber
   machinery — stays, renamed to match. No re-exports for compatibility.
4. **The never-registered Customer.io reactors are deleted**, not migrated.
   They were dead code on every pipeline; if CRM nurturing sync returns, it
   returns as a subscriber with a real counting strategy.
5. **Nothing about dispatch semantics changes.** This is a vocabulary
   retirement, byte-for-byte on queue behavior: same job paths, same dedup
   keys where they carried event identity, same delays, same replay
   exclusion. Anything that would change delivery semantics is out of scope
   and listed below as explicit follow-up work.

## Rationale / Trade-offs

The alternative that was tried — retire the vocabulary and upgrade the
substrate in one motion — produced a 2,388-file pull request that could not be
reviewed and was closed. The opposite failure is also available: migrate
side-effect sites one by one to process managers "for durability" without
noticing that most of them are debounced, lossy-by-contract notifications for
which durable redelivery would be a bug (re-broadcasting snapshots to closed
browsers, re-pinging CRM milestones).

This ADR takes the narrow middle: make the taxonomy honest first, on the
substrate that exists, changing no delivery semantics. That unlocks the
follow-ups as small, individually reviewable decisions rather than one fused
rewrite.

Three follow-ups are explicitly deferred, not rejected:

- **Evaluation dispatch as a per-trace process manager.** The
  `evaluationTrigger` subscriber's thread-idle behavior is implemented as a
  delay-plus-dedup-TTL contraption (#3912) that a process manager would model
  natively (`nextWakeAt` = last activity + idle timeout). It stays a
  subscriber for now because a process manager consumes events through a
  per-event Postgres inbox row, and the trace pipeline's span stream is the
  highest-volume stream in the system — the inbox write amplification is not
  payable there today. A future design must trigger the process off a
  low-volume, pre-deduplicated signal rather than raw span events.
- **Scenario execution on the outbox** (the deferred step 2 of the run-
  execution durability work): dispatching a scenario run is stake-sensitive
  work on a low-volume stream, exactly the process-manager shape. Its
  conversion here is subscriber-for-reactor, semantics preserved; the outbox
  upgrade is its own decision.
- **Billing meter dispatch on the outbox**, for the same reason: losing a
  meter dispatch under-reports billing, and the volume (per project per
  suppression window) is outbox-friendly.

What is compromised: for the deferred sites, the pre-staging loss window
(process dies between fold commit and job staging) remains until each
follow-up lands. That window exists today; this ADR neither widens nor closes
it.

## Consequences

- One authoring surface for best-effort post-event work. The pipeline
  definition now states every side effect inline with its delivery options,
  instead of half here and half in an injected object's `options`.
- The type system stops implying that reactors are a distinct durability
  class. The words available to a reader — subscriber or process manager —
  now match the two guarantees the runtime actually offers.
- `specs/event-sourcing/reactors.feature` is superseded by
  `post-event-work.feature`, and the new file's scenarios are tagged and
  bound to tests, which the old file's never were (an untagged feature file
  reports "all bound" while binding nothing — see `check-feature-parity`).
- The ops pipeline tree and queue tooling keep working unchanged (job paths
  are name-derived), but their "reactor" labels become internal jargon to
  clean up with the machinery rename.
- In-flight queue jobs survive the deploy that ships this change, because
  every registration keeps its name.

## References

- Related ADRs: ADR-026 (superseded), ADR-052, ADR-049, ADR-069, ADR-023/025
  (historical reactor-chain lineage).
- The abandoned big-bang retirement: PRs #6051, #6307, #6406.
- Dead-code deletion precedent: the Customer.io trio was gated on a counting
  strategy that never shipped (`pipelineRegistry.ts` TODO, removed with this
  change).
