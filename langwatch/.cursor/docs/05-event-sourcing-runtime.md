---
title: "Event-sourcing runtime and queues"
description: "How the generic event-sourcing runtime, pipelines, and queues are wired in LangWatch. Architecture guide for understanding design decisions and component interactions."
---

## Overview

We have a generic event-sourcing **library** under `server/event-sourcing/library` and, on top of it, a lightweight **runtime** under `server/event-sourcing/runtime`.

**Why this separation?**
- **Library**: Provides core abstractions (Event, Projection, EventStore, ProjectionStore, EventSourcingService) that are domain-agnostic
- **Runtime**: Provides infrastructure (shared stores, builder pattern, queue processors) that simplifies pipeline registration
- **Pipelines**: Provide domain logic (commands, handlers, projections) specific to each feature

This separation keeps event-sourcing concerns centralized while feature code only plugs in domain logic.

## Architecture Overview

### Three-Layer Architecture

```ascii
┌─────────────────────────────────────────────────────────┐
│  Pipelines (Domain Logic)                               │
│  - Commands (RecordSpanCommand)                         │
│  - Event Handlers (SpanClickHouseWriterHandler)         │
│  - Projection Handlers (TraceProjectionHandler)         │
└─────────────────────────────────────────────────────────┘
                        ↓ uses
┌─────────────────────────────────────────────────────────┐
│  Runtime (Infrastructure)                               │
│  - Singleton EventSourcing instance                     │
│  - Builder pattern for pipeline registration            │
│  - Queue processors (BullMQ integration)                │
│  - Shared event store                                   │
└─────────────────────────────────────────────────────────┘
                        ↓ uses
┌─────────────────────────────────────────────────────────┐
│  Library (Abstractions)                                 │
│  - Event, Projection, EventStream types                 │
│  - EventStore, ProjectionStore interfaces               │
│  - EventSourcingService (orchestration)                 │
│  - Command, CommandHandler types                        │
└─────────────────────────────────────────────────────────┘
```

### Why Separations Exist

**Runtime vs Library:**
- **Runtime** provides **infrastructure**: queues, shared stores, builder pattern, singleton management
- **Library** provides **abstractions**: interfaces, types, service orchestration
- This allows the library to be used directly (for advanced use cases) or via the runtime (for convenience)

**Runtime vs Pipelines:**
- **Runtime** handles **infrastructure concerns**: BullMQ wiring, Redis connections, tracing, retries
- **Pipelines** handle **domain concerns**: what events mean, how to build projections, what side effects to perform
- Feature code doesn't need to know about queues, Redis, or retry logic

## Runtime Building Blocks

The runtime lives in `server/event-sourcing/runtime/` and exposes:

- `EventSourcing` - Singleton class that manages shared infrastructure
- `eventSourcing` - Singleton instance for pipeline registration
- `EventSourcingPipeline` - Pipeline class that wraps EventSourcingService
- `RegisteredPipeline` - Returned pipeline type
- `EventSourcedQueueProcessorImpl` - Queue processor class
- `EventSourcedQueueProcessor` - Queue processor interface

### Singleton Infrastructure

**Why a singleton?**
- Provides a single shared event store instance for all pipelines
- Simplifies pipeline registration (no need to pass stores around)
- Event store is partitioned by `tenantId + aggregateType`, so one instance can handle all aggregate types

**Design:**
```typescript
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly eventStore: EventStore<any>;

  private constructor() {
    // Automatically selects ClickHouse or Memory store
    this.eventStore = clickHouseClient
      ? new EventStoreClickHouse(clickHouseClient)
      : new EventStoreMemory();
  }

  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  getEventStore<EventType>(): EventStore<EventType> {
    return this.eventStore as EventStore<EventType>;
  }
}
```

**Trade-offs:**
- ✅ Simple: No dependency injection needed
- ✅ Convenient: Automatic store selection
- ❌ Less flexible: Can't easily swap stores per pipeline
- ❌ Harder to test: Global state

**Future consideration:** Could be refactored to dependency injection for better testability, but current approach is sufficient for most use cases.

### Builder Pattern

**Why a builder?**
- Type-safe pipeline registration
- Enforces required fields at compile time
- Prevents incomplete pipeline configurations
- Makes pipeline registration declarative and readable

**How it works:**

The builder uses TypeScript's type state machine pattern to enforce required fields:

```typescript
// Step 1: Start with registerPipeline() → PipelineBuilder
eventSourcing.registerPipeline<EventType, ProjectionType>()

// Step 2: Call withName() → PipelineBuilderWithName
.withName("pipeline-name")

// Step 3: Call withAggregateType() → PipelineBuilderWithNameAndType
.withAggregateType("trace")

// Step 4: Optional - add projections, handlers, commands
.withProjection("summary", store, handler)
.withEventHandler("handler-name", handler, options)
.withCommandHandler(CommandHandlerClass)

// Step 5: Call build() → RegisteredPipeline
.build()
```

**Type Safety:**

Each builder stage returns a different type that only allows valid next steps:

```typescript
class PipelineBuilder {
  withName(name: string): PipelineBuilderWithName { /* ... */ }
  build(): never { // Can't build without name
    throw new Error("Pipeline name is required");
  }
}

class PipelineBuilderWithName {
  withAggregateType(type: AggregateType): PipelineBuilderWithNameAndType { /* ... */ }
  build(): never { // Can't build without aggregate type
    throw new Error("Aggregate type is required");
  }
}
```

This ensures you can't call `build()` until all required fields are set, catching errors at compile time.

### Pipeline Registration Flow

When you call `.build()`, here's what happens:

1. **Create EventSourcingService**: The builder instantiates `EventSourcingService` with:
   - Shared event store from singleton
   - Projection definitions (if any)
   - Event handler definitions (if any)
   - Event publisher (if any)
   - Processor checkpoint store (automatically created for handlers and projections)

2. **Create Command Dispatchers**: For each registered command handler:
   - Extract schema, handler instance, and configuration from handler class
   - Create `EventSourcedQueueProcessorImpl` with:
     - Queue name: `{pipeline-name}_{dispatcher-name}`
     - Job name: dispatcher name
     - Process function that validates payload, creates command, calls handler, stores events
   - Attach dispatcher to pipeline under `pipeline.commands.{dispatcherName}`

3. **Return RegisteredPipeline**: Contains:
   - `name`: Pipeline name
   - `aggregateType`: Aggregate type identifier
   - `service`: EventSourcingService instance
   - `commands`: Record of command dispatchers (if any)

**Example:**
```typescript
const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span-ingestion")
  .withAggregateType("span")
  .withCommandHandler(RecordSpanCommand)
  .build();

// pipeline.commands.recordSpan is automatically typed and available
await pipeline.commands.recordSpan.send({ /* ... */ });
```

### Queue Processor Architecture

**Why queue processors?**
- Decouples command/event processing from HTTP request handling
- Provides automatic retries, backoff, and error handling
- Enables batching and debouncing via job ID deduplication
- Handles Redis connection management and graceful shutdown
- Enables sequential processing per aggregate via checkpoints
- Supports both event handlers and projections

**Queue Types:**

The runtime creates three types of queues:
1. **Command queues**: One per command handler (e.g., `span-ingestion_recordSpan`)
2. **Handler queues**: One per event handler (e.g., `span_handler_span-storage`)
3. **Projection queues**: One per projection (e.g., `trace_aggregation_projection_summary`)

**How it works:**

The `QueueProcessorManager` manages queue processors for handlers, projections, and commands. `EventSourcedQueueProcessorImpl` wraps BullMQ with LangWatch-specific features:

```typescript
class EventSourcedQueueProcessorImpl<Payload> {
  constructor(definition: {
    name: string;
    process: (payload: Payload) => Promise<void>;
    makeJobId?: (payload: Payload) => string;
    delay?: number;
    spanAttributes?: (payload: Payload) => Record<string, any>;
    options?: { concurrency?: number };
  }) {
    // Creates BullMQ Queue and Worker
    // Wraps processing in OpenTelemetry spans
    // Applies retry/backoff policies
    // Falls back to inline execution if Redis unavailable
  }

  async send(payload: Payload): Promise<void> {
    // Enqueues job with optional jobId for deduplication
    // Wraps in producer span
  }
}
```

**Key features:**

1. **Idempotency via Job IDs**: When `makeJobId` is provided, BullMQ automatically replaces waiting jobs with the same ID. This enables batching/debouncing:
   ```typescript
   // Multiple calls with same jobId → only last one processes
   await processor.send({ traceId: "trace-123" }); // Job ID: "acme:trace-123"
   await processor.send({ traceId: "trace-123" }); // Replaces previous job
   await processor.send({ traceId: "trace-123" }); // Replaces previous job
   // Only the last one processes after delay
   ```

2. **Delay for Batching**: Combined with job ID deduplication, delay allows later jobs to replace earlier ones:
   ```typescript
   new EventSourcedQueueProcessorImpl({
     makeJobId: (p) => `${p.tenantId}:${p.traceId}`,
     delay: 100, // Wait 100ms before processing
     // If multiple spans arrive for same trace within 100ms, only last one processes
   });
   ```

3. **Inline Execution**: If Redis is unavailable, jobs execute inline. This makes local dev and tests work without Redis:
   ```typescript
   if (!connection) {
     this.isInline = true;
     // Execute process() directly instead of enqueueing
   }
   ```

4. **Observability**: Automatically creates OpenTelemetry spans with attributes:
   ```typescript
   attributes: {
     "queue.name": queueName,
     "queue.job_name": jobName,
     "queue.job_id": jobId,
     ...customAttributes, // From spanAttributes function
   }
   ```

### Command Handler Integration

Command handlers are self-contained classes that bundle:
- Schema (validation)
- Handler implementation
- Configuration methods (getAggregateId, makeJobId, etc.)

**Registration:**
```typescript
class RecordSpanCommand implements CommandHandler<Command<Payload>, Event> {
  static readonly dispatcherName = "recordSpan" as const;
  static readonly schema = defineCommandSchema<Payload>(/* ... */);
  static getAggregateId(payload: Payload): string { /* ... */ }
  static makeJobId(payload: Payload): string { /* ... */ }
  async handle(command: Command<Payload>): Promise<Event[]> { /* ... */ }
}

// Register in pipeline
const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withCommandHandler(RecordSpanCommand)
  .build();
```

**Dispatcher Creation:**

When `.build()` is called, the builder:
1. Extracts dispatcher name from `static dispatcherName` or infers from class name
2. Creates queue processor with:
   - Queue name: `{pipeline-name}_{dispatcher-name}`
   - Process function that:
     - Validates payload using schema
     - Creates command with tenant ID and aggregate ID
     - Calls handler.handle(command)
     - Stores returned events via `pipeline.service.storeEvents()`
3. Attaches dispatcher to `pipeline.commands.{dispatcherName}`

**Type Safety:**

The builder tracks registered command handlers in the type system:

```typescript
type PipelineWithCommandHandlers<
  Pipeline extends RegisteredPipeline,
  Dispatchers extends Record<string, EventSourcedQueueProcessor<any>>,
> = Pipeline & {
  commands: Dispatchers;
};
```

This ensures `pipeline.commands.recordSpan` is properly typed with the correct payload type.

### Event Handler Integration

Event handlers react to individual events and perform side effects:

**Registration:**
```typescript
const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withEventHandler("span-storage", new SpanClickHouseWriterHandler(), {
    eventTypes: ["lw.obs.span.ingestion.recorded"],
    dependsOn: [], // Optional: handler dependencies
  })
  .withEventHandler("trace-aggregation-trigger", new TraceAggregationTriggerHandler(), {
    eventTypes: ["lw.obs.span.ingestion.recorded"],
    dependsOn: ["span-storage"], // Type-safe! Only accepts registered handler names
  })
  .build();
```

**Dependency Resolution:**

The runtime topologically sorts handlers based on dependencies:
1. Builds dependency graph from `dependsOn` options
2. Validates no circular dependencies
3. Executes handlers in dependency order when events are stored

**Event Dispatch:**

When `pipeline.service.storeEvents()` is called:
1. Events are stored in event store
2. Events are published to event publisher (if configured)
3. Events are dispatched to handler queues in dependency order:
   - Filters handlers by event type (if specified)
   - Checks for previous failures (stops dispatch if any)
   - Enqueues events to handler queues (async processing)
   - Each handler processes events sequentially per aggregate
4. Events are dispatched to projection queues:
   - Each projection gets its own queue
   - Events are enqueued for async processing
   - Projections rebuild from all events for the aggregate
   - Sequential ordering enforced per aggregate

**Sequential Processing:**

Both handlers and projections enforce sequential processing:
- Events are assigned sequence numbers (1-indexed) within each aggregate
- Before processing event N, the system verifies event N-1 was processed
- If any event fails, subsequent events for that aggregate stop processing
- Per-aggregate checkpoints track the last processed event (checkpoint key: `tenantId:pipelineName:processorName:aggregateType:aggregateId`)

**Processor Checkpoint Store:**

The runtime automatically creates a `ProcessorCheckpointStore` when handlers or projections are registered:
- **Memory store**: Used in test environment
- **ClickHouse store**: Used in production (if ClickHouse available)
- Tracks per-aggregate processing status (one checkpoint per aggregate tracks last processed event)
- Checkpoint key format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`
- Enables idempotency, sequential ordering, and failure detection

## Span Ingestion Pipeline Example

The span ingestion pipeline demonstrates the full runtime integration:

```typescript
// pipelines/span-ingestion/pipeline.ts
export const spanIngestionPipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span-ingestion")
  .withAggregateType("span")
  .withCommandHandler(RecordSpanCommand)
  .withEventHandler("span-storage", new SpanClickHouseWriterHandler(spanRepository), {
    eventTypes: ["lw.obs.span.ingestion.recorded"],
  })
  .withEventHandler("trace-aggregation-trigger", new TraceAggregationTriggerHandler(), {
    eventTypes: ["lw.obs.span.ingestion.recorded"],
    dependsOn: ["span-storage"],
  })
  .build();
```

**Flow:**
1. Feature code calls `spanIngestionPipeline.commands.recordSpan.send(payload)`
2. Queue processor enqueues job (with deduplication if same trace ID)
3. Job processes: validates payload, creates command, calls `RecordSpanCommand.handle()`
4. Handler returns `SpanIngestionEvent`
5. Event is stored via `pipeline.service.storeEvents()`
6. Event is dispatched to handler queues (via `QueueProcessorManager`):
   - `span-storage` queue: Event enqueued, processed sequentially per aggregate
   - Checkpoint (per aggregate) saved as `pending` → handler processes → checkpoint saved as `processed`
   - `trace-aggregation-trigger` queue: Event enqueued (after span-storage completes)
7. Event is dispatched to projection queues (if any, via `QueueProcessorManager`):
   - Each projection queue processes event sequentially per aggregate
   - Projection rebuilds from all events for the aggregate
   - Checkpoint (per aggregate) saved as `processed` on success

**Sequential Ordering Example:**

If events arrive out of order:
- Event 1 (seq: 1) → processed immediately
- Event 3 (seq: 3) → waits for event 2 (seq: 2) to be processed
- Event 2 (seq: 2) → processed after event 1 completes
- Event 3 → processed after event 2 completes

**Failure Handling:**

If event 2 fails:
- Checkpoint (per aggregate) saved as `failed`
- Event 3 (and subsequent events) stop processing for that aggregate
- Failed events can be identified via `getFailedEvents()` and reprocessed after fixing the issue

## Design Decisions

### Why Singleton?

**Pros:**
- Simple: No dependency injection needed
- Convenient: Automatic store selection
- Shared state: One event store for all pipelines

**Cons:**
- Less flexible: Can't swap stores per pipeline
- Harder to test: Global state
- Less explicit: Dependencies hidden

**Alternative:** Dependency injection would allow:
- Multiple instances with different configurations
- Easier unit testing with mock stores
- More explicit dependencies

**Decision:** Singleton is sufficient for current use case where one shared store is desired. Can be refactored later if needed.

### Why Builder Pattern?

**Pros:**
- Type-safe: Compile-time validation of required fields
- Readable: Declarative pipeline registration
- Extensible: Easy to add new optional fields

**Cons:**
- More complex: Multiple builder classes
- Verbose: Many method calls

**Alternative:** Constructor with options object would be simpler but loses type safety.

**Decision:** Type safety is worth the complexity, especially for preventing runtime errors.

### Why Queue Processors?

**Pros:**
- Decoupling: Async processing separate from HTTP
- Reliability: Automatic retries and error handling
- Observability: Built-in tracing and logging
- Flexibility: Batching, debouncing, rate limiting

**Cons:**
- Complexity: Redis dependency, queue management
- Latency: Async processing adds delay

**Alternative:** Direct function calls would be simpler but lose reliability and observability.

**Decision:** Queues are essential for production reliability. Inline execution fallback makes dev/test easier.

## How to Add a New Event-Sourced Domain

1. **Define domain types** (events, projections, commands)
2. **Implement stores** (projection store, use shared event store)
3. **Implement handlers** (command handlers, event handlers, projection handlers)
4. **Register pipeline** using builder pattern
5. **Use pipeline** in feature code (send commands, rebuild projections)

See the [README](../langwatch/src/server/event-sourcing/library/README.md) for complete examples.

## Summary

The runtime provides:
- **Shared infrastructure**: Singleton event store, queue processors (via `QueueProcessorManager`), processor checkpoint store
- **Type-safe registration**: Builder pattern with compile-time validation
- **Queue integration**: BullMQ with automatic retries, tracing, and inline fallback
- **Command/event dispatch**: Automatic validation, storage, and handler execution
- **Sequential processing**: Per-aggregate ordering enforcement via sequence numbers and checkpoints
- **Per-aggregate checkpointing**: One checkpoint per aggregate tracks last processed event (key: `tenantId:pipelineName:processorName:aggregateType:aggregateId`)
- **Projection queues**: Async processing for projections, similar to event handlers

This keeps event-sourcing infrastructure centralized while feature code focuses on domain logic.
