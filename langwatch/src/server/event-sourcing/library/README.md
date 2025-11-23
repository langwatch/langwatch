# Event Sourcing Library

A generic, reusable event sourcing library for building event-driven systems with projections.

For conceptual overview and architecture, see [OVERVIEW.md](./OVERVIEW.md).

## Creating a Pipeline

Create a pipeline using the fluent builder pattern:

```typescript
import { eventSourcing } from "../../runtime";
import {
  createTenantId,
  type ProjectionHandler,
  type EventStream,
  type TenantId,
} from "./library";

// Define event and projection types
interface MyEvent {
  id: string;
  aggregateId: string;
  tenantId: TenantId;
  timestamp: number;
  type: "my.event.type";
  data: {
    /* ... */
  };
}

interface MyProjection {
  id: string;
  aggregateId: string;
  tenantId: TenantId;
  version: number;
  data: {
    /* ... */
  };
}

// Implement projection handler
class MyProjectionHandler implements ProjectionHandler<MyEvent, MyProjection> {
  handle(stream: EventStream<TenantId, MyEvent>): MyProjection {
    const events = stream.getEvents();
    // Build projection from events
    return {
      /* ... */
    };
  }
}

// Create pipeline
const pipeline = eventSourcing
  .registerPipeline<MyEvent, MyProjection>()
  .withName("m_pipeline")
  .withAggregateType("my_aggregate")
  .withProjection("summary", MyProjectionHandler)
  .build();

// Use pipeline
await pipeline.service.storeEvents(events, {
  tenantId: createTenantId("tenant-id"),
});
const projection = await pipeline.service.getProjectionByName(
  "summary",
  "aggregate-id",
  {
    tenantId: createTenantId("tenant-id"),
  },
);
```

**Basic usage:**

- **Commands**: Register with `.withCommand(name, HandlerClass)` → access via `pipeline.commands.commandName.send()`
- **Event Handlers**: Register with `.withEventHandler(name, HandlerClass)` → process events asynchronously via queues with sequential ordering
- **Projections**: Register with `.withProjection(name, HandlerClass)` → process events asynchronously via queues, access via `pipeline.service.getProjectionByName()`
- **Events**: Store via `pipeline.service.storeEvents()` → triggers handlers and updates projections automatically
- **Checkpoints**: Automatically tracked per-aggregate for both handlers and projections (one checkpoint per aggregate tracks last processed event), enabling idempotency and sequential ordering

## Navigating the Codebase

### Library (`library/`)

The library contains no feature/product specifcs, so this is not the section you are looking for if you need that, look down.

- **`domain/`** - Core domain types (Event, Projection, TenantId, AggregateType)
- **`commands/`** - Command handling (Command, CommandHandler, CommandSchema)
- **`streams/`** - EventStream for ordered event processing
- **`services/`** - EventSourcingService (main orchestration) and modular services:
  - **`services/validation/`** - EventProcessorValidator, SequenceNumberCalculator, IdempotencyChecker, OrderingValidator, FailureDetector
  - **`services/checkpoints/`** - CheckpointManager (checkpoint operations with error handling)
  - **`services/queues/`** - QueueProcessorManager (manages queue processors for handlers, projections, commands)
  - **`services/handlers/`** - EventHandlerDispatcher (dispatches events to handlers)
  - **`services/projections/`** - ProjectionUpdater (handles projection updates)
  - **`services/errorHandling.ts`** - Standardized error categorization and handling
  - **`services/dispatchStrategy.ts`** - Dispatch strategy pattern (sync vs async)
- **`stores/`** - Store interfaces (EventStore, ProjectionStore, ProcessorCheckpointStore)
- **`domain/handlers/`** - Handler interfaces (EventHandler, ProjectionHandler)
- **`publishing/`** - Event publishing interface
- **`queues/`** - Queue processor interfaces
- **`utils/`** - Utilities including `checkpointKey.ts` for checkpoint key construction

**Entry point:** `index.ts` exports all public APIs

### Runtime (`runtime/`)

Runtime infrastructure and pipeline builder:

- **`eventSourcing.ts`** - Singleton instance and shared event store
- **`pipeline/`** - Pipeline builder (fluent API for registering pipelines)
- **`queue/`** - Queue implementations (Memory, BullMQ)

**Entry point:** `index.ts` exports `eventSourcing` singleton

### Stores (`stores/`)

Concrete store implementations:

- **`eventStoreClickHouse.ts`** / **`eventStoreMemory.ts`** - Event store implementations
- **`processorCheckpointStoreClickHouse.ts`** / **`processorCheckpointStoreMemory.ts`** - Processor checkpoint stores (for handlers and projections)

## Cautions, Security & Best Practices

### Security: Tenant Isolation

⚠️ **CRITICAL**: Always validate tenant context in store implementations.

```typescript
import { EventUtils } from "./library";

class MyEventStore implements EventStore<MyEvent> {
  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<MyEvent>,
    aggregateType: AggregateType,
  ): Promise<readonly MyEvent[]> {
    // CRITICAL: Validate tenant before any query
    EventUtils.validateTenantId(context, "getEvents");

    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = ?",
      [aggregateId, context.tenantId, aggregateType],
    );
  }
}
```

**Always:**

- Use `createTenantId()` to create tenant IDs
- Call `EventUtils.validateTenantId()` in store implementations
- Filter queries by `tenantId` in all database operations
- Never trust tenant context from external sources

See: [Security & Concurrency Guide](../../../.cursor/docs/06-event-sourcing-library.md)

### Distributed Locking

For production deployments with multiple workers, provide a `DistributedLock` to prevent concurrent projection updates:

```typescript
import { RedisDistributedLock } from "./library";

const pipeline = eventSourcing
  .registerPipeline<MyEvent, MyProjection>()
  .withName("my_pipeline")
  .withAggregateType("my_aggregate")
  .withEventProjection("summary", store, handler)
  .build();

// Lock is automatically used when updating projections
```

Without distributed locking, concurrent updates to the same aggregate projection may result in lost updates.

### Testing

Use in-memory stores for tests:

```typescript
import { EventStoreMemory, ProjectionStoreMemory } from "../stores";

const eventStore = new EventStoreMemory(new EventRepositoryMemory());
const projectionStore = new ProjectionStoreMemory();

const pipeline = eventSourcing
  .registerPipeline<MyEvent, MyProjection>()
  .withName("test_pipeline")
  .withAggregateType("test")
  .withEventProjection("test", projectionStore, handler)
  .build();
```

**Run tests:**

```bash
npm test src/server/event-sourcing/library
```

### Common Pitfalls

1. **Missing tenant validation**: Always validate `tenantId` in store implementations
2. **Concurrent updates**: Use distributed locking in production
3. **Event ordering**: Events are automatically ordered by timestamp (see Event Ordering section)
4. **Sequential processing**: Events must be processed in sequence number order - if a previous event fails, subsequent events stop processing
5. **Projection updates**: Projections are automatically updated after `storeEvents()` via queues - manual updates only needed for recovery
6. **Checkpoint stores**: Processor checkpoint stores are automatically created for handlers and projections when using the runtime
7. **Checkpoint keys**: Checkpoint keys use format `tenantId:pipelineName:processorName:aggregateType:aggregateId` (one checkpoint per aggregate, not per event)

## Reference

### Common Patterns

#### Command → Event → Handler

```typescript
import { z } from "zod";
import { defineCommandSchema, EventUtils } from "./library";

const spanPayloadSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
});

class RecordSpanCommand
  implements
    CommandHandler<Command<z.infer<typeof spanPayloadSchema>>, SpanEvent>
{
  static readonly dispatcherName = "recordSpan" as const;
  static readonly schema = defineCommandSchema(
    "lw.obs.span_ingestion.record",
    spanPayloadSchema,
  );

  static getAggregateId(payload: z.infer<typeof spanPayloadSchema>): string {
    return payload.traceId;
  }

  async handle(
    command: Command<z.infer<typeof spanPayloadSchema>>,
  ): Promise<SpanEvent[]> {
    const event = EventUtils.createEvent(
      "span_ingestion",
      command.aggregateId,
      command.tenantId,
      "lw.obs.span_ingestion.recorded",
      { traceId: command.data.traceId, spanId: command.data.spanId },
      void 0,
      void 0,
      { includeTraceContext: true },
    );
    return [event];
  }
}

const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span-ingestion")
  .withAggregateType("span")
  .withCommand("recordSpan", RecordSpanCommand)
  .build();

await pipeline.commands.recordSpan.send({
  tenantId: "acme",
  traceId: "trace-123",
  spanId: "span-456",
});
```

#### Event Handlers for Side Effects

Event handlers and projections process events with identical validation and checkpointing logic. Both enforce sequential ordering per aggregate - events are processed in sequence number order, and if any event fails, subsequent events for that aggregate skip processing gracefully (storeEvents succeeds, but processing is skipped). Sequential ordering violations cause storeEvents to reject (hard constraint).

Event handlers process individual events asynchronously via queues.

```typescript
import type { EventHandler } from "./library";

class SpanClickHouseWriterHandler implements EventHandler<SpanEvent> {
  constructor(private spanRepository: SpanRepository) {}

  static getEventTypes() {
    return ["lw.obs.span_ingestion.recorded"] as const;
  }

  async handle(event: SpanEvent): Promise<void> {
    // This handler is idempotent - the system tracks checkpoints per aggregate
    // If this event was already processed, it will be skipped automatically
    await this.spanRepository.insertSpan(event.data.spanData);
  }
}

const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span_ingestion")
  .withAggregateType("span_ingestion")
  .withEventHandler("spanStorage", SpanClickHouseWriterHandler, {
    // Optional: override eventTypes, configure concurrency, delay, job ID factory, etc.
  })
  .build();
```

**Key features:**

- **Sequential ordering**: Events are processed in sequence number order per aggregate
- **Per-aggregate checkpoints**: One checkpoint per aggregate tracks the last processed event (checkpoint key: `tenantId:pipelineName:processorName:aggregateType:aggregateId`)
- **Idempotency**: Already processed events are automatically skipped via EventProcessorValidator
- **Failure handling**: If an event fails, subsequent events for that aggregate stop processing
- **Queue-based**: Events are processed asynchronously via queues (BullMQ or Memory)
- **Validation**: EventProcessorValidator orchestrates sequence number calculation, idempotency checking, ordering validation, and failure detection

#### Multiple Projections

Projections are processed asynchronously via queues, similar to event handlers. Each event triggers a projection rebuild, but the rebuild uses all events for the aggregate to ensure consistency.

```typescript
const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("trace_aggregation")
  .withAggregateType("trace_aggregation")
  .withProjection("summary", SummaryProjectionHandler)
  .withProjection("analytics", AnalyticsProjectionHandler)
  .build();

// Projections are automatically updated after events are stored
await pipeline.service.storeEvents(events, {
  tenantId: createTenantId("acme"),
});

// Access projections
const summary = await pipeline.service.getProjectionByName(
  "summary",
  "trace-123",
  {
    tenantId: createTenantId("acme"),
  },
);
```

**Key features:**

- **Queue-based processing**: Each projection has its own queue processor
- **Per-event triggering**: Each event triggers a projection rebuild
- **Full rebuild**: Projections rebuild from all events for the aggregate (not incremental)
- **Sequential ordering**: Events are processed in sequence number order
- **Per-aggregate checkpoints**: One checkpoint per aggregate tracks the last processed event for the projection

### API Reference

#### Pipeline Registration

```typescript
const pipeline = eventSourcing
  .registerPipeline<EventType, ProjectionType>()
  .withName("pipeline_name")
  .withAggregateType("aggregate_type")
  .withProjection("projectionName", ProjectionHandlerClass)
  .withEventHandler("handlerName", EventHandlerClass, {
    eventTypes: ["event.type"],
  })
  .withCommand("commandName", CommandHandlerClass)
  .withEventPublisher(publisher)
  .build();
```

#### Projection Operations

```typescript
// Get projection
const projection = await pipeline.service.getProjectionByName(
  "projection-name",
  "aggregate-id",
  { tenantId: createTenantId("tenant-id") },
);

// Check if projection exists
const exists = await pipeline.service.hasProjectionByName(
  "projection-name",
  "aggregate-id",
  { tenantId: createTenantId("tenant-id") },
);

// Update projection manually (typically only for recovery)
const projection = await pipeline.service.updateProjectionByName(
  "projection-name",
  "aggregate-id",
  { tenantId: createTenantId("tenant-id") },
);
```

#### Storing Events

```typescript
// Store events (triggers event handlers and updates projections automatically)
await pipeline.service.storeEvents(events, {
  tenantId: createTenantId("tenant-id"),
});
```

#### Sending Commands

```typescript
// Send command (automatically queued and processed)
await pipeline.commands.commandName.send({
  tenantId: "tenant-id",
  // ... command payload
});
```

### Event Ordering

Events are automatically ordered when building projections. Additionally, the system enforces sequential processing per aggregate using sequence numbers.

**Event Stream Ordering:**

```typescript
// Timestamp ordering (default)
const stream = new EventStream(aggregateId, tenantId, events);

// As-is ordering (use when DB pre-sorts)
const stream = new EventStream(aggregateId, tenantId, events, {
  ordering: "as-is",
});

// Custom ordering
const stream = new EventStream(aggregateId, tenantId, events, {
  ordering: (a, b) => a.data.sequenceNumber - b.data.sequenceNumber,
});
```

**Sequential Processing:**

The system computes sequence numbers (1-indexed) for each event within its aggregate and enforces strict sequential processing:

- Events are assigned sequence numbers based on their position in chronological order
- Handlers and projections process events in sequence number order
- If event N hasn't been processed, event N+1 will not be processed (throws error)
- If any event fails, subsequent events for that aggregate stop processing
- This ensures consistency and prevents out-of-order processing

Sequence numbers are computed using `countEventsBefore()` - the number of events that occurred before this event (by timestamp and ID), plus 1. The `EventProcessorValidator` orchestrates validation by coordinating `SequenceNumberCalculator`, `IdempotencyChecker`, `OrderingValidator`, and `FailureDetector`.

### Additional Resources

- **Architecture Overview**: See [OVERVIEW.md](./OVERVIEW.md) for core concepts and architecture
- **Runtime Architecture**: See [Runtime Architecture](../../../.cursor/docs/05-event-sourcing-runtime.md) for how the runtime works
- **Security & Concurrency**: See [Library Guide](../../../.cursor/docs/06-event-sourcing-library.md) for security pitfalls and implementation patterns
- **Type Definitions**:
  - `domain/types.ts` - Core types (Event, Projection)
  - `stores/eventStore.types.ts` - Event store interface
  - `stores/projectionStore.types.ts` - Projection store interface
  - `stores/eventHandlerCheckpointStore.types.ts` - Processor checkpoint store interface
  - `services/eventSourcingService.ts` - Main service
  - `utils/event.utils.ts` - Utilities
