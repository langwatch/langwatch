# Post-event work

Use an event subscriber for a lightweight reaction to a committed event, a
projection subscriber when the reaction needs an exact committed projection
document, and a process manager when the system makes a durable promise.

```text
command → committed event ──→ event subscriber
                         └──→ projection commit ──→ projection subscriber
                         └──→ process inbox + state + intents
                                                   ├──→ durable next wake
                                                   └──→ leased intent executor
```

Projection replay rebuilds projections only. It does not stage subscribers or
drive process managers.

## Event subscribers

An event subscriber has no projection state:

```ts
.withEventSubscriber("auditEvent", (subscriber) =>
  subscriber
    .on(spanReceived)
    .when(isAuditable)
    .handle(auditEvent),
)
```

The relevance predicate runs before staging. Its input is the typed event and
it performs no I/O. The handler is retry-safe and receives only event context.

## Projection subscribers

A projection subscriber names a projection declared earlier in the same
pipeline. The builder infers its committed document type:

```ts
.withProjectionSubscriber("evaluationTrigger", (subscriber) =>
  subscriber
    .after("traceSummary")
    .on(spanReceived, traceCompleted)
    .when(shouldEvaluate)
    .handle(triggerEvaluation),
)
```

The subscriber is staged only after the projection repository and required
cache commit. A failed projection write never exposes a partial document.

Both subscriber forms are at-least-once after staging. Subscriber work is
appropriate only when the handler is idempotent for the source event and the
domain can tolerate the pre-staging loss window. Every externally visible
subscriber action must use a stable action identity derived from the
subscriber action and source event identity, or atomically deduplicate and
apply the action in one database transaction. Queue deduplication alone is not
the idempotency boundary. Each product subscriber must have a redelivery test
that handles the same source event twice and observes one result.

## Process managers

A process manager owns durable multi-event orchestration:

```ts
.withProcessManager("triggerSettlement", (process) =>
  process
    .on(triggerFired, usageRecorded, settlementDue)
    .key(settlementKey)
    .initial(initialSettlement)
    .evolve(evolveSettlement)
    .execute(executeSettlement),
)
```

The evolution is pure and synchronous. It derives state, the next wake and
deterministically keyed intents from an event or wake input. Intent executors
perform I/O and are retry-safe.

The runtime commits inbox identity, process state, wake state and intent
messages through the process-store port. Concrete Postgres transaction and
lease behavior belongs to the application adapter.

A process may also declare a schema-validated synchronous signal with
`.onSignal(name, schema, evolve)`. Call it through
`eventSourcing.processRuntime.signal(...)` with a caller-stable signal ID. The
runtime only signals an existing process, compare-and-swaps its revision,
retries bounded revision losses, and returns the committed or idempotently
recovered state. Signal state, wake changes and intents use the same atomic
process-store commit as event delivery.

Use the same stable domain identity for command grouping and process keys when
FIFO ordering is a domain guarantee. Persist bounded IDs, timing and
configuration in process state and intent payloads; resolve large content from
its canonical store at execution time.

## Choosing the primitive

- Need only the committed event: event subscriber.
- Need a named projection's exact committed document: projection subscriber.
- Need durable state, a scheduled wake or guaranteed intent: process manager.

There is no generic side-effect primitive whose consistency boundary is
implicit. The author chooses one of these three contracts at registration.

See the [Eventing framework boundary](./adrs/20260820-eventing-framework-boundary.md)
and [post-event work specification](./specs/post-event-work.feature).
