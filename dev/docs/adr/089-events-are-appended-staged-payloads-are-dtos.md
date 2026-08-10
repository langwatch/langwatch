# ADR-089: Events are appended; staged payloads are plain DTOs

**Date:** 2026-08-06

**Status:** Draft

**Relates to:** [ADR-026](./026-groupqueue-payload-envelope.md) (the queue's transport envelope — the *header* a staged payload rides in, distinct from the payload itself), [ADR-066](./066-projection-clickhouse-cached-store.md) (the version gate projections carry), [ADR-069](./069-payload-cost-doctrine.md) (the staging seam that minted the first pseudo-events), [ADR-080](./080-staged-job-id-is-identity-not-state.md) (staged job identity).

## Context

The event-sourcing layer had exactly one noun for a versioned, typed payload: `Event`. The log stores events. Projections fold events. Process managers consume events. And the routing seam's `stage` hook was typed to return events — so anything a subscriber needed to carry on its queue had to wear the `Event` brand, even when it would never reach the log.

The codebase paid for that missing distinction for three generations. Reactors consumed events non-durably and were retired. ADR-069's claim-check, `span_referenced`, was a "valid Event brand" that its own docblock had to disclaim: *"never appended to the event log"* — and to keep the type system honest, a parallel registry had to be invented for it (`TRACE_PROCESSING_STAGING_EVENT_TYPES`, "staging-only brands … registered solely so a `stage` hook can return them as well-typed Events"). The bounded-derivation work then added `span_facts_lifted` to the same class, with the same disclaiming docblock.

Each mechanism was individually sound: the payloads genuinely need `type`/`version`/schema discipline, because a queue job written by an old producer must be readable by a new consumer across a deploy. What was not sound is the vocabulary. A reader who sees `EventSchema.extend(…)` assumes event-log semantics — durable, replayable, foldable — and the only thing standing between that assumption and a wrong change was a comment shouting "never appended". Every new staging payload re-litigated the same explanation, and from the outside each one read as "yet another event type", i.e. as architectural churn, when the durable model had not moved at all.

## Decision

Two nouns, four consumers, one rule.

**Event** — a durable fact appended to `event_log`. Immutable, replayable, the input to every fold. The only thing that extends `EventSchema`.

**Staged payload** — a versioned, typed DTO owned by a queue lane: a claim-check reference, a lifted derivation, any staged job body. A plain zod object, colocated with the handler that consumes it. It keeps the same `type`/`version`/`data` discipline as an event — a shape an old build cannot read fails loudly into the queue's retry, never into a silent completion — because that is what survives a rolling deploy. It is never appended, never folded, never replayed, and it does not extend `EventSchema` or any shared base.

Deliberately **no `EnvelopeSchema`**. A shared base class for staged payloads was considered and rejected: it would recreate the parallel-registry problem under a new name, and there is no invariant behind it — the wire discipline is per-lane, and each lane pins its wire contract with a literal fixture in its tests instead of inheriting a brand.

The consumers of the log, exhaustively:

- **projection** (fold / map / postgres) — a pure function of the log; replayable; version-gated (ADR-066).
- **process manager** — consumes events, issues commands through the durable outbox; not replayed from `event_log`.
- **eventsub** — at-least-once queue consumer for side effects; not replayed from `event_log`; everything it is handed beyond the event itself is a staged payload.

"Not replayed" throughout this ADR means *not re-driven from `event_log`*. It is not a claim that a handler runs once: eventsub is at-least-once, so queue redelivery and retries remain ordinary, which is why a durable record like `span_facts_contributed` is idempotency-keyed. Nor does Redis persistence make a staged payload a replay source — a redelivered job is the same hop happening again, not history being re-read.

The rule: **a type extends `EventSchema` if and only if it is appended to `event_log`.** Where a `stage` hook swaps an event for a staged payload, the seam is typed as that union explicitly — there is no registry that launders payloads into events.

## Replay and durability

A staged payload is the courier between two durable records, and replayability never depends on it. The span-facts flow is the canonical example: `span_received` (appended, trace-processing log) → `span_facts_lifted` (queue only) → `span_facts_contributed` (appended, coding-agent log, idempotency-keyed) → the `codingAgentSession` fold. Replaying a session re-folds `span_facts_contributed`; the courier is never consulted. Persisting the staged payload would store the same facts twice one hop apart. The only non-durable link is the queue hop itself, which is Redis durability plus retries — the same exposure every subscriber job has, unchanged by this vocabulary.

## Consequences

- **Applied.** PR #6621 re-typed both members of the class — `span_referenced` and `span_facts_lifted` — into plain payload schemas with byte-identical wire shapes, and deleted `TRACE_PROCESSING_STAGING_EVENT_TYPES` and the "staging-only brands" carve-out in `typeIdentifiers.ts` outright. The invariant holds in the codebase today with zero exceptions.
- Because the wire shape did not move, the re-typing was compile-time only: jobs staged by prior builds parse unchanged, and ADR-069's deploy-order rules were not in play.
- A shrink-proof guard (the `replicatedEngineGuard` pattern: every type extending `EventSchema` must appear in a pipeline's append-side `*_EVENT_TYPES` array) is available as a follow-up ratchet; it would seed empty.
- Future staging payloads have a named, boring thing to reach for — a plain versioned DTO with a fixture-pinned wire contract — and "we added an event" on a PR means, again, exactly one thing.

## References

- `platform/app/src/server/event-sourcing/pipelines/trace-processing/schemas/events.ts` — the re-typed claim-check payload and its wire-contract fixture.
- `platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/commands/contributeSpanFactsCommand.ts` — the durable record the courier feeds.
- PR #6621 — the application of this rule.
- ADR numbering note: 087 is currently claimed by two open PRs; this ADR takes 089 because 088 is claimed by an open PR as well.
