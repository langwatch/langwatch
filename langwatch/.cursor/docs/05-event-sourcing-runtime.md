---
title: "Event-sourcing runtime and queues"
description: "How the generic event-sourcing runtime, pipelines, and queues are wired in LangWatch."
---

## Overview

We have a generic event-sourcing **library** under `server/event-sourcing/library` and, on top of it, a lightweight **runtime** under `server/event-sourcing/runtime`.
This runtime gives you:

- A single way to **register pipelines** (event store + projection store + handler).
- A small API to **attach BullMQ queues/workers** without exposing queue details to feature code.
- A reusable pattern for **new domains** (traces today, evaluations or others later).

The goal is to keep event-sourcing concerns centralized, while feature code only plugs in domain logic.

## Runtime building blocks

The runtime lives in `server/event-sourcing/runtime/index.ts` and exposes:

- `EventSourcing` - Singleton class that manages shared infrastructure
- `eventSourcing` - Singleton instance for pipeline registration
- `EventSourcingPipeline` - Pipeline class
- `RegisteredPipeline` - Returned pipeline type
- `EventSourcedQueueProcessorImpl` - Queue processor class
- `EventSourcedQueueProcessor` - Queue processor interface

### Singleton infrastructure

The runtime provides a singleton `eventSourcing` instance that manages shared infrastructure:

- **Shared event store**: A single `EventStore` instance that handles all aggregate types (partitioned by `tenantId + aggregateType`)
- **Shared checkpoint repository**: For bulk rebuild operations
- **Builder pattern**: Type-safe pipeline registration

### Pipeline registration

To register a pipeline, use the builder pattern via the singleton:

```ts
import { eventSourcing } from "../../event-sourcing/runtime";

const pipeline = eventSourcing
  .registerPipeline<MyEvent, MyProjection>()
  .withName("my-domain")
  .withAggregateType("trace")  // or "user", "evaluation", etc.
  .withProjectionStore(myProjectionStore)
  .withEventHandler(myEventHandler)
  .build();
```

The builder enforces required fields through TypeScript types:
1. Start with `registerPipeline<EventType, ProjectionType>()`
2. Set name with `withName(name)`
3. Set aggregate type with `withAggregateType(type)`
4. Set projection store with `withProjectionStore(store)`
5. Set event handler with `withEventHandler(handler)`
6. Build with `build()` to get a `RegisteredPipeline`

This returns a `RegisteredPipeline`:

- `name`: logical pipeline name
- `aggregateType`: the aggregate type identifier
- `service`: the `EventSourcingService` instance for this pipeline

Feature code should use the `service` when it needs to rebuild or fetch projections, instead of wiring the event-sourcing library directly.

### Queue processors

For queues, the runtime provides `EventSourcedQueueProcessorImpl` class:

```ts
import { EventSourcedQueueProcessorImpl } from "../../event-sourcing/runtime";

const processor = new EventSourcedQueueProcessorImpl<MyJobPayload>({
  queueName: "{my_queue}",
  jobName: "my_job",
  makeJobId: (payload) => `${payload.tenantId}:${payload.aggregateId}`,  // Optional: for idempotency
  async process(payload) {
    // domain logic goes here
  },
  options: {
    concurrency: 5,  // Optional: worker concurrency (default: 5)
  },
});
```

Under the hood, this:

- Creates a BullMQ `Queue` and `Worker` using the shared `redis` connection.
- Wraps enqueue and job processing in LangWatch tracer spans.
- Applies sensible defaults (retries, backoff, removal policies).
- Executes jobs **inline** if Redis is not available, so local dev and tests keep working.

Feature code calls:

```ts
await processor.send(payload);
```

and does not interact with BullMQ directly. The processor also provides a `close()` method for graceful shutdown during application teardown.

## Centralized trace-processing pipeline

Trace-processing is registered once in `server/event-sourcing/pipelines/trace-processing/pipeline.ts`:

- Uses the shared event store from `eventSourcing.getEventStore()` (singleton)
- Builds:
  - `TraceProjectionStoreClickHouse` / `TraceProjectionStoreMemory`
  - `SpanReadRepositoryClickHouse`
- Creates a `TraceProjectionEventHandler` using the span read repository.
- Uses the builder pattern to register the pipeline:
  ```ts
  export const traceProcessingPipeline = eventSourcing
    .registerPipeline<SpanEvent, TraceProjection>()
    .withName("trace-processing")
    .withAggregateType("trace")
    .withProjectionStore(projectionStore)
    .withEventHandler(eventHandler)
    .build();
  ```

This module is now the **single place** where trace event-sourcing wiring lives.

## Span ingestion and trace processing flow

Span ingestion now uses an **async, command-driven** flow managed by the event-sourcing runtime; feature code is queue-agnostic.

- `SpanIngestionService` maps incoming spans to `RecordSpanProcessingCommandData` DTOs.
- For each job it sends a **span processing command** via the runtime-managed queue processor
  `spanProcessingCommandDispatcher` (defined in
  `server/event-sourcing/pipelines/span-processing/pipeline.ts`).
- The queue processor:
  - Issues a `trace.record_span_ingestion` command via the shared
    `traceProcessingCommandHandler`.
  - The command handler persists the span via `SpanStoreClickHouse`.
  - Appends a `span.ingestion.ingested` event to the trace event store.
  - Calls `traceProcessingPipeline.service` to rebuild the trace projection for that trace.

This makes span ingestion + trace projection an event-sourced, async flow owned by the runtime wiring, with feature code only responsible for mapping and sending commands.

## How to add a new event-sourced domain

To integrate a new domain (e.g. evaluations) with the runtime:

1. **Define events and projections**
   - Use the core types from `server/event-sourcing/library`:
     - `Event`, `Projection`, `EventStream`, etc.
   - Create domain-specific event+projection types under your feature.

2. **Implement stores and handler**
   - **Event store**: Use the shared event store from `eventSourcing.getEventStore()` (no need to create your own - it's partitioned by `tenantId + aggregateType`).
   - **Projection store**: Create a ClickHouse-backed or in-memory projection store for your aggregate.
   - **Event handler**: Create a class that implements `EventHandler` and builds projections from an `EventStream`.

3. **Register a pipeline**
   - Create a module under `server/event-sourcing/pipelines/your-domain/pipeline.ts`:
     - Instantiate your projection store and handler.
     - Use the builder pattern to register:
       ```ts
       import { eventSourcing } from "../../event-sourcing/runtime";

       const projectionStore = clickHouseClient
         ? new YourProjectionStoreClickHouse(clickHouseClient)
         : new YourProjectionStoreMemory();

       const eventHandler = new YourEventHandler();

       export const yourDomainPipeline = eventSourcing
         .registerPipeline<YourEvent, YourProjection>()
         .withName("your-domain")
         .withAggregateType("your_aggregate_type")  // Add to AggregateType union if new
         .withProjectionStore(projectionStore)
         .withEventHandler(eventHandler)
         .build();
       ```
   - Export the registered pipeline so other code can reuse its `service`.

4. **Attach queues (if needed)**
   - Define your job payload type.
   - Use `EventSourcedQueueProcessorImpl` to:
     - Send jobs from your feature code using `processor.send(payload)`.
     - Handle jobs via a small `process(payload)` function that:
       - Writes domain events via the pipeline's event store (use `pipeline.service.storeEvents()`).
       - Calls pipeline commands or `service` methods to rebuild projections.

5. **Keep concerns separate**
   - Feature code should:
     - Define domain events, projections, and handlers.
     - Call pipeline services and queue processors.
   - The runtime should:
     - Handle wiring of BullMQ, Redis, tracing, and retries.
     - Provide shared infrastructure (event store, checkpoint repository).

This keeps the event-sourcing system centralized, clean, and easy to extend as we add more event-sourced features.


