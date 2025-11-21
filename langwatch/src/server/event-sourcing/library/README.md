# Event Sourcing Library

A generic, reusable event sourcing library for building event-driven systems with projections.

For conceptual overview and architecture, see [OVERVIEW.md](./OVERVIEW.md).

## Creating a Pipeline

Create a pipeline using the fluent builder pattern:

```typescript
import { eventSourcing } from "../../runtime";
import {
  createTenantId,
  type EventHandler,
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
class MyProjectionHandler implements EventHandler<MyEvent, MyProjection> {
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
  .withName("my-pipeline")
  .withAggregateType("my-aggregate")
  .withProjection("summary", projectionStore, new MyProjectionHandler())
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

- **Commands**: Register with `.withCommandHandler()` → access via `pipeline.commands.commandName.send()`
- **Event Handlers**: Register with `.withEventHandler()` → process events asynchronously
- **Projections**: Register with `.withProjection()` → access via `pipeline.service.getProjectionByName()`
- **Events**: Store via `pipeline.service.storeEvents()` → triggers handlers and updates projections automatically

## Navigating the Codebase

### Library (`library/`)

The library contains no feature/product specifcs, so this is not the section you are looking for if you need that, look down.

- **`domain/`** - Core domain types (Event, Projection, TenantId, AggregateType)
- **`commands/`** - Command handling (Command, CommandHandler, CommandSchema)
- **`streams/`** - EventStream for ordered event processing
- **`services/`** - EventSourcingService (main orchestration)
- **`stores/`** - Store interfaces (EventStore, ProjectionStore, EventHandlerCheckpointStore)
- **`domain/handlers/`** - Handler interfaces (EventHandler, EventReactionHandler)
- **`publishing/`** - Event publishing interface
- **`queues/`** - Queue processor interfaces

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
- **`eventHandlerCheckpointStoreClickHouse.ts`** / **`eventHandlerCheckpointStoreMemory.ts`** - Checkpoint stores

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
  .withName("my-pipeline")
  .withAggregateType("my-aggregate")
  .withProjection("summary", store, handler)
  .build();

// Lock is automatically used when updating projections
```

Without distributed locking, concurrent updates to the same aggregate projection may result in lost updates.

### Testing

Use in-memory stores for tests:

```typescript
import { EventStoreMemory, ProjectionStoreMemory } from "../stores";

const eventStore = new EventStoreMemory();
const projectionStore = new ProjectionStoreMemory();

const pipeline = eventSourcing
  .registerPipeline<MyEvent, MyProjection>()
  .withName("test-pipeline")
  .withAggregateType("test")
  .withProjection("test", projectionStore, handler)
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
4. **Projection updates**: Projections are automatically updated after `storeEvents()` - manual updates only needed for recovery

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
  implements CommandHandler<Command<z.infer<typeof spanPayloadSchema>>, SpanEvent>
{
  static readonly dispatcherName = "recordSpan" as const;
  static readonly schema = defineCommandSchema(
    "lw.obs.span_ingestion.record",
    spanPayloadSchema,
  );

  static getAggregateId(payload: z.infer<typeof spanPayloadSchema>): string {
    return payload.traceId;
  }

  async handle(command: Command<z.infer<typeof spanPayloadSchema>>): Promise<SpanEvent[]> {
    const event = EventUtils.createEventWithProcessingTraceContext(
      command.aggregateId,
      command.tenantId,
      "lw.obs.span_ingestion.recorded",
      { traceId: command.data.traceId, spanId: command.data.spanId },
    );
    return [event];
  }
}

const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span-ingestion")
  .withAggregateType("span")
  .withCommandHandler(RecordSpanCommand)
  .build();

await pipeline.commands.recordSpan.send({
  tenantId: "acme",
  traceId: "trace-123",
  spanId: "span-456",
});
```

#### Event Handlers for Side Effects

```typescript
import type { EventReactionHandler } from "./library";

class SpanClickHouseWriterHandler implements EventReactionHandler<SpanEvent> {
  constructor(private spanRepository: SpanRepository) {}

  getEventTypes() {
    return ["lw.obs.span_ingestion.recorded"];
  }

  async handle(event: SpanEvent): Promise<void> {
    await this.spanRepository.insertSpan(event.data.spanData);
  }
}

const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("span-ingestion")
  .withAggregateType("span_ingestion")
  .withEventHandler(
    "span-storage",
    new SpanClickHouseWriterHandler(repository),
    {
      eventTypes: ["lw.obs.span_ingestion.recorded"],
    },
  )
  .build();
```

#### Multiple Projections

```typescript
const pipeline = eventSourcing
  .registerPipeline<SpanEvent>()
  .withName("trace-aggregation")
  .withAggregateType("trace_aggregation")
  .withProjection("summary", summaryStore, summaryHandler)
  .withProjection("analytics", analyticsStore, analyticsHandler)
  .build();

const summary = await pipeline.service.getProjectionByName(
  "summary",
  "trace-123",
  {
    tenantId: createTenantId("acme"),
  },
);
```

### API Reference

#### Pipeline Registration

```typescript
const pipeline = eventSourcing
  .registerPipeline<EventType, ProjectionType>()
  .withName("pipeline-name")
  .withAggregateType("aggregate-type")
  .withProjection("projection-name", store, handler)
  .withEventHandler("handler-name", handler, { eventTypes: ["event.type"] })
  .withCommandHandler(CommandHandlerClass)
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

Events are automatically ordered when building projections:

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

### Additional Resources

- **Architecture Overview**: See [OVERVIEW.md](./OVERVIEW.md) for core concepts and architecture
- **Runtime Architecture**: See [Runtime Architecture](../../../.cursor/docs/05-event-sourcing-runtime.md) for how the runtime works
- **Security & Concurrency**: See [Library Guide](../../../.cursor/docs/06-event-sourcing-library.md) for security pitfalls and implementation patterns
- **Type Definitions**:
  - `domain/types.ts` - Core types (Event, Projection)
  - `stores/eventStore.types.ts` - Event store interface
  - `stores/projectionStore.types.ts` - Projection store interface
  - `services/eventSourcingService.ts` - Main service
  - `utils/event.utils.ts` - Utilities
