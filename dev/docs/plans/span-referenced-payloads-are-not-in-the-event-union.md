# `makeId` is typed for events it is documented to receive and cannot name

**Not a live defect** — the runtime behaviour is right, and the subscriber's own
docblock explains why. What is wrong is that the type says something the code
contradicts, and the eleven errors left in `@langwatch/coding-agent-server` are
that contradiction surfacing.

## The fact

`coding-agent-span-facts-dispatch.subscriber.ts` declares
`EventSubscriberDefinition<TraceProcessingEvent>`, so the framework types its
`deduplication.makeId` parameter as `TraceProcessingEvent`. That union is:

```
SpanReceivedEvent | SpanRecordedEvent | TopicAssignedEvent |
LogRecordReceivedEvent | LogContributedEvent |
MetricDataPointCorrelatedEvent | OriginResolvedEvent |
AnnotationAddedEvent | AnnotationRemovedEvent |
AnnotationsBulkSyncedEvent | TraceNameChangedEvent
```

`SpanReferencedPayload` is not in it. But `makeId` runs on the STAGING path,
and staging is exactly where a span becomes a reference —
`makeSpanReferencedPayload` builds a full event-shaped object
(`id`, `aggregateId`, `tenantId`, `createdAt`, `occurredAt`, `type`, `data`,
`metadata`) whose `type` is `lw.obs.trace.span_referenced`.

The subscriber knows this. `dedupIdentity`'s docblock says so directly:

> The correlation id is the right fallback precisely because it is what ties a
> claim-check back to the event it was lifted from: `makeSpanReferencedPayload`
> copies `event.id` verbatim, so the key stays stable across the reference
> upgrade…

So the function reasons about a value its parameter type excludes.

## What it costs

`coding-agent-span-facts-dispatch.subscriber.redelivery.test.ts` asserts the
thing that matters — that a reference payload and the event it was lifted from
produce the SAME dedup id, so an id-less span is not silently dropped inside
the TTL. To do that it has to hand `makeId` a reference payload, and writes
`as TraceProcessingEvent`. TypeScript now refuses that cast because the two
shapes do not overlap: eleven `TS2352`s, all one assertion repeated.

## The fork

1. **Add the span-referenced event to `TraceProcessingEvent`.** Truthful — it
   is dispatched, it is event-shaped, and the union is what the pipeline
   claims to carry. The cost is exhaustiveness: every `switch` over the union
   gains a case it must answer, and some of those live in the app.
2. **Widen only what receives both.** `dedupIdentity` takes
   `TraceProcessingEvent | SpanReferencedPayload`, and the subscriber declares
   itself over that union so the framework types `makeId` the same way. Local,
   and states the truth where the truth is, but it makes one subscriber's
   event type differ from every other trace subscriber's.

(2) has the smaller blast radius and is probably right, but it changes what the
eventing framework is told a subscriber handles, so it is written down rather
than taken.

**Not resolved with a double cast.** `as unknown as TraceProcessingEvent` would
make the eleven errors go away and leave the contradiction in place, which is
the same move that produced the seven lying `GrantsFake`s and the fixtures that
described shapes nothing returns.
