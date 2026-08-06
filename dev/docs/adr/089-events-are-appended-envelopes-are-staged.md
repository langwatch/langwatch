# ADR-089: Events are appended; everything staged is an envelope

**Date:** 2026-08-06

**Status:** Draft

**Relates to:** [ADR-026](./026-groupqueue-payload-envelope.md) (the queue envelope this vocabulary makes first-class), [ADR-066](./066-projection-clickhouse-cached-store.md) (the version gate projections carry), [ADR-069](./069-payload-cost-doctrine.md) (the staging seam that minted the first pseudo-events), [ADR-080](./080-staged-job-id-is-identity-not-state.md) (the header those envelopes already ride in).

## Context

The event-sourcing layer has exactly one noun for a versioned, typed payload: `Event`. The log stores events. Projections fold events. Process managers consume events. And the routing seam's `stage` hook is typed to return events — so anything a subscriber needs carried on its queue must wear the `Event` brand, whether or not it will ever reach the log.

The codebase has been paying for that missing second noun for three generations. Reactors consumed events non-durably and were retired. ADR-069's claim-check twin, `span_referenced`, is a "valid Event brand" that its own docblock must disclaim: *"never appended to the event log — which is why it is deliberately absent from `TRACE_PROCESSING_EVENT_TYPES`"* (`trace-processing/schemas/constants.ts`). To keep the type system honest, a parallel registry had to be invented for it — `TRACE_PROCESSING_STAGING_EVENT_TYPES`, "staging-only brands … registered solely so a `stage` hook can return them as well-typed Events" (`typeIdentifiers.ts`). The bounded-derivation work now adds `span_facts_lifted` to the same class, with the same disclaiming docblock.

Each of these mechanisms is individually sound: the payloads genuinely need `type`/`version`/schema discipline, because a queue job written by an old producer must be readable by a new consumer across a deploy. What is not sound is the vocabulary. A reader who sees `spanFactsLiftedEventSchema = EventSchema.extend(…)` assumes event-log semantics — durable, replayable, foldable — and the only thing standing between that assumption and a wrong change is a comment shouting "never appended". Every new staging payload re-litigates the same explanation, and from the outside each one reads as "yet another event type", i.e. as architectural churn, when the durable model has not moved at all.

There are 76 `EventSchema.extend` sites across 14 pipeline schema files today. All but the staging-only brands are appended. The distinction is real, load-bearing, and currently expressed only in comments.

## Decision

Two nouns, four consumers, one rule.

**Event** — a durable fact appended to `event_log`. Immutable, replayable, the input to every fold. The only thing that extends `EventSchema`.

**Envelope** — a versioned, typed payload that travels between the routing seam and a queue: claim-check references, lifted facts, any staged job body. Versioned for deploy overlap exactly as events are (an unknown version fails loudly into the queue's retry, per the `span_referenced` contract). Never appended, never folded, never replayed. Extends an `EnvelopeSchema` sibling with the same `type`/`version`/`data` shape — never `EventSchema`.

The consumers of the log, exhaustively:

- **projection** (fold / map / postgres) — a pure function of the log; replayable; version-gated (ADR-066).
- **process manager** — consumes events, issues commands through the durable outbox; not replayed.
- **eventsub** — at-least-once queue consumer for side effects; not replayed; everything it is handed beyond the event itself is an envelope.

The rule: **a type extends `EventSchema` if and only if it is appended to `event_log`.** The `stage` hook's return type widens to `Event | Envelope`, which deletes the reason the staging-only pseudo-events exist.

## Rationale / Trade-offs

The alternative to a second noun is what we have: per-site disclaimers plus parallel "staging-only" registries whose entire job is to make the type system tolerate the lie. That scales linearly in confusion — every future bounded-derivation or claim-check lane adds another disclaimed event, and every reader of `EVENT_TYPE_IDENTIFIERS` must hold the exception list in their head.

The cost of the rename is small and bounded: the envelope class currently has two members (`span_referenced` on main, `span_facts_lifted` in flight), the wire format does not change (the `type`/`version`/`data` shape is identical; only the TypeScript brand and the schema it extends move), and the staging seam already isolates the affected call sites. Nothing about the durable model — the log, the folds, the outbox — changes at all, which is the point: the vocabulary makes visible that it never was changing.

## Consequences

- `EnvelopeSchema` lands next to `EventSchema` with the same shape and a docblock stating the contract once, instead of per type.
- `span_referenced` and `span_facts_lifted` re-parent to it; the `TRACE_PROCESSING_STAGING_EVENT_TYPES` registry and the "staging-only brands" carve-out in `typeIdentifiers.ts` are deleted rather than renamed — the envelope type registry replaces them.
- A shrink-only ratchet (the `replicatedEngineGuard` pattern) enforces the rule: every type extending `EventSchema` must appear in a pipeline's append-side `*_EVENT_TYPES` array; the allowlist seeds with the two current staging brands and shrinks to zero as they re-parent. New violations fail the build with a message that names this ADR.
- The `span_facts_lifted` re-parent waits for its in-flight PR to land rather than churning it mid-review; it becomes the first application, not a precondition.
- Future staging payloads have a named thing to reach for, and "we added an event" on a PR means, again, exactly one thing.

## References

- `platform/app/src/server/event-sourcing/pipelines/trace-processing/schemas/constants.ts` — the `span_referenced` contract and its disclaimer.
- `platform/app/src/server/event-sourcing/schemas/typeIdentifiers.ts` — the staging-only carve-out this deletes.
- ADR numbering note: 087 is currently claimed by two open PRs; this ADR takes 089 because 088 is claimed by an open PR as well.
