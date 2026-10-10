# ADR-035: Persist actions evaluate settled trace state

**Date:** 2026-06-03

**Status:** Accepted

**Related:** [per-trigger dispatch timing](./026-per-trigger-dispatch-timing.md)
and [automation process managers](./052-automations-on-process-manager-substrate.md).

## Context

`ADD_TO_DATASET` and `ADD_TO_ANNOTATION_QUEUE` copy trace-derived data into a
durable customer resource. Evaluating them against the first partial trace
state can write a truncated row that differs from the trace an operator sees
after later spans arrive.

Persist effects are idempotent, but idempotency alone does not make an early
snapshot complete. Their filters must use the same settled-state boundary as
notification actions.

## Decision

Persist actions participate in the trigger's deterministic settle windows.
The projection subscriber records a compact trigger match, and the
`triggerSettlement` process manager schedules the evaluation round using
`traceDebounceMs`.

When the round is due, the intent executor:

1. reads the latest settled trace projection;
2. evaluates the trigger filters;
3. checks the permanent `(triggerId, traceId)` claim;
4. performs the dataset or annotation write; and
5. records the claim only after the write succeeds.

Writing the claim after the effect preserves retryability. If a retryable
effect fails, the leased intent remains eligible for another attempt. Dataset
entry identities and annotation upserts keep a repeated attempt safe when the
effect succeeds but the claim write does not.

A failed filter does not create a permanent claim. Later activity belongs to a
new settle window, may observe a more complete trace, and may produce the one
successful persist effect.

Persist actions do not use notification cadence. Each accepted trace produces
its own bounded intent, or its own member within a bounded persist-intent page
during a match storm.

## Alternatives considered

Dispatching directly from a projection subscriber would bind the effect to a
possibly partial fold and leave no durable retry boundary. Claiming before the
effect would convert a transient failure into silent loss. A static subscriber
delay cannot express a per-trigger debounce or durable re-arming.

## Consequences

- Dataset and annotation writes reflect settled trace state.
- Retryable failures remain retryable.
- Cross-pipeline races converge through one atomic claim and idempotent effect
  identities.
- Persist timing is configured by `traceDebounceMs`; notification cadence does
  not apply.
