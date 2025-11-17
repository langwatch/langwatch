# Event Sourcing Library

A generic, reusable event sourcing library for building event-driven systems with projections.

⚠️ **CRITICAL**: Read the [Security & Concurrency Guide](../../../.cursor/docs/06-event-sourcing-library.md) before implementing stores. Always use `validateTenantId()` to enforce tenant isolation.

## Overview

This library provides core event sourcing patterns:

- **Events**: Immutable facts about what happened
- **Projections**: Computed views built from events
- **Event Stores**: Persist and query events
- **Projection Stores**: Persist and query projections
- **Event Handlers**: Transform event streams into projections
- **Event Sourcing Service**: Orchestrates the pipeline

### Architecture

```
Commands → EventStore → Events → EventHandler → Projection → ProjectionStore
                ↓                      ↓                          ↓
            getEvents()          handle(stream)            storeProjection()
```

## Quick Start

### Basic Usage

#### Using the Runtime (Recommended)

```typescript
import { eventSourcing } from "../../runtime";
import type { EventHandler, EventStream } from "./library";
import { createTenantId } from "./library";

// 1. Implement event handler
class TraceEventHandler
  implements EventHandler<string, TraceEvent, TraceProjection>
{
  handle(stream: EventStream<string, TraceEvent>): TraceProjection {
    const events = stream.getEvents();
    const trace = { spans: [], metadata: {} };

    for (const event of events) {
      // Process each event...
    }

    return {
      id: stream.getAggregateId(),
      aggregateId: stream.getAggregateId(),
      tenantId: createTenantId("acme"), // Required
      version: Date.now(),
      data: trace,
    };
  }
}

// 2. Register pipeline using runtime builder
const pipeline = eventSourcing
  .registerPipeline<TraceEvent, TraceProjection>()
  .withName("trace-processing")
  .withAggregateType("trace")
  .withProjectionStore(myProjectionStore)
  .withEventHandler(new TraceEventHandler())
  .build();

// 3. Rebuild projection using the pipeline service
const projection = await pipeline.service.rebuildProjection("trace-123", {
  eventStoreContext: { tenantId: createTenantId("acme") },
  projectionStoreContext: { tenantId: createTenantId("acme") },
});
```

#### Direct Service Instantiation (Advanced)

```typescript
import {
  EventSourcingService,
  type EventHandler,
  type EventStream,
  createTenantId,
} from "./library";

// 1. Implement event handler (same as above)
class TraceEventHandler
  implements EventHandler<string, TraceEvent, TraceProjection>
{
  handle(stream: EventStream<string, TraceEvent>): TraceProjection {
    // ... same implementation
  }
}

// 2. Create service directly
const service = new EventSourcingService({
  aggregateType: "trace",
  eventStore: myEventStore,
  projectionStore: myProjectionStore,
  eventHandler: new TraceEventHandler(),
  serviceOptions: {
    // Optional: hooks, ordering, etc.
  },
  logger: myLogger, // Optional
  distributedLock: myDistributedLock, // Optional: for concurrent rebuild protection
  rebuildLockTtlMs: 5 * 60 * 1000, // Optional: default 5 minutes
});

// 3. Rebuild projection
const projection = await service.rebuildProjection("trace-123", {
  eventStoreContext: { tenantId: createTenantId("acme") },
  projectionStoreContext: { tenantId: createTenantId("acme") },
});
```

### Implementing EventStore

```typescript
import {
  EventStore,
  EventUtils,
  type AggregateType,
  type EventStoreReadContext,
  type EventStoreWriteContext,
  type EventStoreListCursor,
  type ListAggregateIdsResult,
} from "./library";

class MyEventStore implements EventStore<string, MyEvent> {
  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<string, MyEvent>,
    aggregateType: AggregateType,
  ): Promise<readonly MyEvent[]> {
    // MUST validate tenant
    EventUtils.validateTenantId(context, "getEvents");

    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = ?",
      [aggregateId, context.tenantId, aggregateType],
    );
  }

  async storeEvents(
    events: readonly MyEvent[],
    context: EventStoreWriteContext<string, MyEvent>,
    aggregateType: AggregateType,
  ): Promise<void> {
    // MUST validate tenant
    EventUtils.validateTenantId(context, "storeEvents");

    // MUST validate events
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error("Invalid event");
      }
    }

    await this.db.insert(
      events.map((event) => ({
        ...event,
        tenant_id: context.tenantId,
        aggregate_type: aggregateType,
      })),
    );
  }

  async listAggregateIds(
    context: EventStoreReadContext<string, MyEvent>,
    aggregateType: AggregateType,
    cursor?: EventStoreListCursor,
    limit?: number,
  ): Promise<ListAggregateIdsResult<string>> {
    // MUST validate tenant
    EventUtils.validateTenantId(context, "listAggregateIds");

    // For batch processing
    const ids = await this.db
      .select("DISTINCT aggregate_id")
      .from("events")
      .where("tenant_id", context.tenantId)
      .where("aggregate_type", aggregateType)
      .where("aggregate_id", ">", cursor || "")
      .limit(limit || 100)
      .execute();

    return {
      aggregateIds: ids.map((r) => r.aggregate_id),
      nextCursor:
        ids.length === (limit || 100)
          ? ids[ids.length - 1].aggregate_id
          : undefined,
    };
  }
}
```

### Implementing ProjectionStore

```typescript
import {
  ProjectionStore,
  EventUtils,
  type ProjectionStoreReadContext,
  type ProjectionStoreWriteContext,
} from "./library";

class MyProjectionStore implements ProjectionStore<string, MyProjection> {
  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<MyProjection | null> {
    EventUtils.validateTenantId(context, "getProjection");

    return await this.db.findOne({
      aggregate_id: aggregateId,
      tenant_id: context.tenantId,
    });
  }

  async storeProjection(
    projection: MyProjection,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(context, "storeProjection");

    if (!EventUtils.isValidProjection(projection)) {
      throw new Error("Invalid projection");
    }

    await this.db.upsert({
      aggregate_id: projection.aggregateId,
      tenant_id: context.tenantId,
      data: projection.data,
      version: projection.version,
    });
  }
}
```

### Using Hooks

Hooks can be configured when creating the service directly or via the runtime (though runtime doesn't currently expose hooks configuration - use direct service instantiation for hooks):

```typescript
import { EventSourcingService } from "./library";

const service = new EventSourcingService({
  aggregateType: "trace",
  eventStore,
  projectionStore,
  eventHandler,
  serviceOptions: {
    hooks: {
      beforeHandle: async (stream, metadata) => {
        if (stream.isEmpty()) throw new Error("Empty stream");
      },

      afterHandle: async (stream, projection, metadata) => {
        projection.data.processedAt = Date.now();
      },

      afterPersist: async (projection, metadata) => {
        await this.notifySubscribers(projection);
      },
    },
  },
});
```

### Batch Processing

```typescript
import { createTenantId } from "./library";

const checkpoint = await service.rebuildProjectionsInBatches({
  batchSize: 100,
  eventStoreContext: { tenantId: createTenantId("acme") },
  projectionStoreContext: { tenantId: createTenantId("acme") },
  resumeFrom: savedCheckpoint, // Resume from previous run

  onProgress: async (progress) => {
    console.log(`Processed ${progress.checkpoint.processedCount}`);
    await saveCheckpoint(progress.checkpoint);
  },
});
```

### Event Ordering

```typescript
// Timestamp ordering (default)
const stream1 = new EventStream(aggregateId, events);

// As-is ordering (DB pre-sorted)
const stream2 = new EventStream(aggregateId, events, { ordering: "as-is" });

// Custom ordering
const stream3 = new EventStream(aggregateId, events, {
  ordering: (a, b) => a.data.sequenceNumber - b.data.sequenceNumber,
});
```

## Observability

Pass a logger for structured logging. The service automatically creates OpenTelemetry spans with attributes like `tenant.id`, `aggregate.id`, `event.count`, etc.

## Testing

```bash
npm test src/server/event-sourcing/library
```

Tests cover core components, hook error recovery, batch failures, validation, and edge cases.

## API Reference

See TypeScript interfaces:

- [core/types.ts](./core/types.ts) - Core types
- [stores/eventStore.ts](./stores/eventStore.ts) - Event store interface
- [stores/projectionStore.types.ts](./stores/projectionStore.types.ts) - Projection store interface
- [services/eventSourcingService.ts](./services/eventSourcingService.ts) - Main service
- [utils/event.utils.ts](./utils/event.utils.ts) - Utilities

For detailed security requirements, concurrency considerations, and implementation checklists, see the [comprehensive guide](../../../.cursor/docs/06-event-sourcing-library.md).
