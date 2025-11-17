# Event Sourcing Library

A generic, reusable event sourcing library for building event-driven systems with projections.

⚠️ **CRITICAL**: Read the [Security & Concurrency Guide](../../../.cursor/docs/01-event-sourcing-library.md) before implementing stores. Always use `validateTenantId()` and enforce tenant isolation.

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

```typescript
import { EventSourcingService } from "./library";

// 1. Implement event handler
class TraceEventHandler implements EventHandler<string, TraceEvent, TraceProjection> {
  handle(stream: EventStream<string, TraceEvent>): TraceProjection {
    const events = stream.getEvents();
    const trace = { spans: [], metadata: {} };
    
    for (const event of events) {
      // Process each event...
    }
    
    return {
      id: stream.getAggregateId(),
      aggregateId: stream.getAggregateId(),
      version: Date.now(),
      data: trace,
    };
  }
}

// 2. Create service
const service = new EventSourcingService({
  eventStore: myEventStore,
  projectionStore: myProjectionStore,
  eventHandler: new TraceEventHandler(),
  logger: myLogger,  // Optional
});

// 3. Rebuild projection
const projection = await service.rebuildProjection("trace-123", {
  eventStoreContext: { tenantId: "acme" },
});
```

### Implementing EventStore

```typescript
import { EventStore, EventUtils } from "./library";

class MyEventStore implements EventStore<string, MyEvent> {
  async getEvents(aggregateId: string, context) {
    // MUST validate tenant
    EventUtils.validateTenantId(context, 'getEvents');
    
    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ?",
      [aggregateId, context.tenantId]
    );
  }
  
  async storeEvents(events: readonly MyEvent[]) {
    // MUST validate events
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error("Invalid event");
      }
    }
    
    await this.db.insert(events);
  }
  
  async listAggregateIds(context, cursor, limit) {
    // For batch processing
    const ids = await this.db
      .select("DISTINCT aggregate_id")
      .from("events")
      .where("tenant_id", context.tenantId)
      .where("aggregate_id", ">", cursor || "")
      .limit(limit)
      .execute();
      
    return {
      aggregateIds: ids.map(r => r.aggregate_id),
      nextCursor: ids.length === limit ? ids[ids.length - 1].aggregate_id : undefined,
    };
  }
}
```

### Implementing ProjectionStore

```typescript
import { ProjectionStore, EventUtils } from "./library";

class MyProjectionStore implements ProjectionStore<string, MyProjection> {
  async getProjection(aggregateId: string, context) {
    EventUtils.validateTenantId(context, 'getProjection');
    
    return await this.db.findOne({
      aggregate_id: aggregateId,
      tenant_id: context.tenantId,
    });
  }
  
  async storeProjection(projection: MyProjection, context) {
    EventUtils.validateTenantId(context, 'storeProjection');
    
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

```typescript
const service = new EventSourcingService({
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
const checkpoint = await service.rebuildProjectionsInBatches({
  batchSize: 100,
  eventStoreContext: { tenantId: "acme" },
  resumeFrom: savedCheckpoint,  // Resume from previous run
  
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
npm test src/server/features/trace-processing/library
```

Tests cover core components, hook error recovery, batch failures, validation, and edge cases.

## API Reference

See TypeScript interfaces:
- [core/types.ts](./core/types.ts) - Core types
- [stores/eventStore.ts](./stores/eventStore.ts) - Event store interface
- [stores/projectionStore.types.ts](./stores/projectionStore.types.ts) - Projection store interface
- [services/eventSourcingService.ts](./services/eventSourcingService.ts) - Main service
- [utils/event.utils.ts](./utils/event.utils.ts) - Utilities

For detailed security requirements, concurrency considerations, and implementation checklists, see the [comprehensive guide](../../../.cursor/docs/01-event-sourcing-library.md).
