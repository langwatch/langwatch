---
title: "Event Sourcing Library: Architecture, Security, and Implementation"
description: "Comprehensive guide to the generic event sourcing library covering architecture, security pitfalls, concurrency patterns, and implementation details for LLMs working with the codebase."
---

## Overview

The event sourcing library under `src/server/event-sourcing/library` provides core abstractions for building event-driven systems. This document explains the architecture, security requirements, concurrency considerations, and implementation patterns.

**Key Design Principles:**
- **Domain-agnostic**: Works for any aggregate type (traces, users, evaluations, etc.)
- **Type-safe**: TypeScript types enforce correctness at compile time
- **Multi-tenant**: Built-in tenant isolation via branded TenantId type
- **Observable**: OpenTelemetry tracing and structured logging throughout
- **Extensible**: Hooks, custom ordering, and pluggable stores

## Library Architecture

### Core Abstractions

**Event**: Immutable fact about what happened
```typescript
interface Event<Payload = unknown, Metadata = EventMetadataBase> {
  id: string;
  aggregateId: string;
  tenantId: TenantId; // Branded type, not plain string
  timestamp: number;
  type: EventType;
  data: Payload;
  metadata?: Metadata;
}
```

**Projection**: Computed view built from events
```typescript
interface Projection<Data = unknown> {
  id: string;
  aggregateId: string;
  tenantId: TenantId;
  version: number;
  data: Data;
}
```

**EventStream**: Ordered collection of events with metadata
- Automatically sorts events (timestamp, as-is, or custom)
- Provides metadata (count, first/last timestamps)
- Removes ordering logic from handlers

**EventStore**: Persists and queries events
- Partitioned by `tenantId + aggregateType`
- Context-aware (read/write contexts with tenant ID)
- Optional scanning for bulk operations

**ProjectionStore**: Persists and queries projections
- Context-aware (read/write contexts with tenant ID)
- Handles versioning and deduplication

**EventSourcingService**: Orchestrates the pipeline
- Rebuilds projections from events
- Manages event ordering and stream creation
- Supports hooks for extensibility
- Optional distributed locking for concurrency control
- Enforces sequential processing per aggregate via sequence numbers
- Manages per-aggregate checkpoints for handlers and projections
- Composes modular services for maintainability

**ProcessorCheckpointStore**: Tracks processing status per aggregate
- Used for both event handlers and projections
- Tracks per-aggregate status (one checkpoint per aggregate tracks last processed event)
- Checkpoint key format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`
- Enables sequential ordering enforcement
- Enables idempotency and failure detection

### Modular Service Architecture

The event sourcing library uses a modular service architecture for maintainability and testability:

- **EventProcessorValidator**: Orchestrates validation by coordinating sequence number calculation, idempotency checking, ordering validation, and failure detection
- **CheckpointManager**: Manages checkpoint operations with error handling (wraps checkpoint store calls)
- **QueueProcessorManager**: Manages queue processors for handlers, projections, and commands
- **EventHandlerDispatcher**: Dispatches events to handlers (supports both sync and async dispatch via queues)
- **ProjectionUpdater**: Handles projection updates (supports both sync and async dispatch via queues)
- **SequenceNumberCalculator**: Computes sequence numbers for events
- **IdempotencyChecker**: Checks if events were already processed and atomically claims them
- **OrderingValidator**: Verifies that the previous sequence number was processed
- **FailureDetector**: Checks if any previous events failed

These services are composed by `EventSourcingService` to provide the complete event sourcing functionality.

### Component Relationships

```
EventSourcingService
  ├── EventStore (getEvents, storeEvents, countEventsBefore)
  ├── ProjectionStore (getProjection, storeProjection)
  ├── ProcessorCheckpointStore (saveCheckpoint, loadCheckpoint, getCheckpointBySequenceNumber, hasFailedEvents)
  ├── EventProcessorValidator (orchestrates validation)
  │   ├── SequenceNumberCalculator (computes sequence numbers)
  │   ├── IdempotencyChecker (checks idempotency, atomically claims events)
  │   ├── OrderingValidator (validates sequential ordering)
  │   └── FailureDetector (detects failed events)
  ├── CheckpointManager (manages checkpoint operations)
  ├── QueueProcessorManager (manages queue processors)
  ├── EventHandlerDispatcher (dispatches events to handlers)
  ├── ProjectionUpdater (handles projection updates)
  ├── EventHandler (builds projections from EventStream)
  ├── EventReactionHandler (reacts to individual events)
  ├── EventPublisher (publishes events to external systems)
  └── DistributedLock (optional, for concurrent projection updates)
```

## Security Considerations

### Tenant Isolation

**CRITICAL**: Tenant isolation is the most important security requirement. Failure to enforce it can lead to data breaches.

#### The Problem

In a multi-tenant system, tenants must never access each other's data. Without proper isolation:
- Tenant A could read Tenant B's events
- Tenant A could modify Tenant B's projections
- Data corruption and security breaches

#### The Solution

**1. Use Branded TenantId Type**

The library uses a branded `TenantId` type (not a plain string) to prevent accidental mixing:

```typescript
// ❌ WRONG: Plain string
const tenantId = "acme";

// ✅ CORRECT: Branded type
import { createTenantId } from "./library";
const tenantId = createTenantId("acme");
```

**2. Always Validate Tenant Context**

Every store method MUST validate tenant ID before any operation:

```typescript
import { EventUtils } from "./library";

class SecureEventStore implements EventStore<string, Event> {
  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<string, Event>,
    aggregateType: AggregateType,
  ): Promise<readonly Event[]> {
    // CRITICAL: Validate tenantId before ANY query
    EventUtils.validateTenantId(context, "EventStore.getEvents");

    // Query MUST filter by tenant ID
    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = ?",
      [aggregateId, context.tenantId, aggregateType]
    );
  }
}
```

**3. Validate Events Belong to Tenant**

When storing events, ensure all events belong to the context tenant:

```typescript
async storeEvents(
  events: readonly Event[],
  context: EventStoreWriteContext<string, Event>,
  aggregateType: AggregateType,
): Promise<void> {
  EventUtils.validateTenantId(context, "storeEvents");

  // Validate all events belong to same tenant
  const tenantIds = new Set(events.map(e => e.tenantId));
  if (tenantIds.size !== 1 || !tenantIds.has(context.tenantId)) {
    throw new Error("[SECURITY] All events must belong to context tenant");
  }

  // Validate event structure
  for (const event of events) {
    if (!EventUtils.isValidEvent(event)) {
      throw new Error(`[SECURITY] Invalid event: ${JSON.stringify(event)}`);
    }
  }

  await this.db.insert(events);
}
```

#### Common Security Pitfalls

**Pitfall 1: Missing Tenant Validation**

```typescript
// ❌ DANGEROUS: No tenant validation
async getEvents(aggregateId: string, context: EventStoreReadContext) {
  return await this.db.query(
    "SELECT * FROM events WHERE aggregate_id = ?",
    [aggregateId] // Missing tenant_id filter!
  );
}
```

**Fix:**
```typescript
// ✅ SAFE: Always validate and filter
async getEvents(aggregateId: string, context: EventStoreReadContext) {
  EventUtils.validateTenantId(context, "getEvents");
  return await this.db.query(
    "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ?",
    [aggregateId, context.tenantId]
  );
}
```

**Pitfall 2: Using Raw Context to Bypass Security**

```typescript
// ❌ DANGEROUS: Using raw to bypass tenant checks
async getEvents(aggregateId: string, context: EventStoreReadContext) {
  if (context?.raw?.bypassSecurity) {
    return await this.db.query("SELECT * FROM events WHERE aggregate_id = ?", [aggregateId]);
  }
  // ...
}
```

**Fix:**
```typescript
// ✅ SAFE: raw is for optimization only, never security
async getEvents(aggregateId: string, context: EventStoreReadContext) {
  EventUtils.validateTenantId(context, "getEvents"); // Always validate
  const query = this.buildQuery(aggregateId, context.tenantId);

  // Use raw for optimization hints only
  if (context?.raw?.useIndex) {
    query.useIndex(context.raw.useIndex);
  }

  return query.execute();
}
```

**Pitfall 3: Aggregate ID Collisions**

Using complex objects as aggregate IDs without proper `toString()` causes collisions:

```typescript
// ❌ DANGEROUS: Both become "[object Object]"
const obj1 = { tenantId: "tenant1", id: "foo" };
const obj2 = { tenantId: "tenant2", id: "bar" };

const stream1 = new EventStream(obj1, events1);
const stream2 = new EventStream(obj2, events2);

// ID COLLISION!
stream1.getMetadata().aggregateId === stream2.getMetadata().aggregateId // "[object Object]"
```

**Fix:**
```typescript
// ✅ SAFE: Use strings or implement toString()
const aggregateId1 = "tenant1:foo";
const aggregateId2 = "tenant2:bar";

// Or use a class with toString()
class AggregateId {
  constructor(
    private tenantId: string,
    private id: string,
  ) {}

  toString(): string {
    return `${this.tenantId}:${this.id}`;
  }
}
```

### Input Validation

**Always validate inputs before storing:**

```typescript
import { EventUtils } from "./library";

  async storeEvents(events: readonly Event[]) {
    // Validate BEFORE storing
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(`[SECURITY] Invalid event: ${JSON.stringify(event)}`);
      }
    }

    await this.db.insert(events);
}
```

### Security Checklist

- [ ] Call `EventUtils.validateTenantId()` in ALL store read/write methods
- [ ] Tenant isolation enforced in all store queries (WHERE tenant_id = ?)
- [ ] Input validation on all writes (use `isValidEvent`/`isValidProjection`)
- [ ] Aggregate IDs are strings/numbers or have proper `toString()`
- [ ] Metadata/raw fields don't bypass security checks
- [ ] Test cross-tenant access attempts (should throw)
- [ ] Events validated to belong to context tenant before storage

## Sequential Ordering & Per-Aggregate Checkpointing

### Sequence Numbers

Events are assigned **sequence numbers** (1-indexed) based on their position in chronological order within each aggregate. The `SequenceNumberCalculator` computes sequence numbers using `countEventsBefore()` - the number of events that occurred before this event (by timestamp and ID), plus 1.

**Computation:**
```typescript
// In SequenceNumberCalculator
async computeEventSequenceNumber(
  event: EventType,
  context: EventStoreReadContext<EventType>,
): Promise<number> {
  const count = await this.eventStore.countEventsBefore(
    String(event.aggregateId),
    context,
    this.aggregateType,
    event.timestamp,
    event.id,
  );
  return count + 1; // 1-indexed
}
```

**Properties:**
- **Deterministic**: Same event always gets same sequence number
- **Stable**: Sequence numbers don't change once assigned
- **Per-aggregate**: Sequence numbers are scoped to `tenantId + aggregateId + aggregateType`

### Sequential Processing Enforcement

The `EventProcessorValidator` orchestrates validation by coordinating:
- **SequenceNumberCalculator**: Computes sequence numbers for events
- **IdempotencyChecker**: Checks if events were already processed and atomically claims them
- **OrderingValidator**: Verifies that the previous sequence number (N-1) was processed
- **FailureDetector**: Checks if any previous events failed (stops processing if so)

The system enforces strict sequential processing per aggregate:

1. **Before processing event N:**
   - Compute sequence number using `SequenceNumberCalculator`
   - Check if event N was already processed (idempotency via `IdempotencyChecker`)
   - Check if any previous events failed (stop processing gracefully via `FailureDetector`)
   - Verify event N-1 was processed (sequential ordering via `OrderingValidator`)

2. **During processing:**
   - `CheckpointManager` saves checkpoint as `pending` before processing
   - Execute handler/projection logic
   - `CheckpointManager` saves checkpoint as `processed` on success, `failed` on failure

3. **After failure:**
   - `CheckpointManager` saves checkpoint as `failed` with error message
   - Subsequent events for that aggregate stop processing (detected by `FailureDetector`)
   - Failed events can be identified and reprocessed

**Implementation:**
```typescript
// EventProcessorValidator orchestrates validation
const sequenceNumber = await validator.computeEventSequenceNumber(event, context);
const shouldSkip = await validator.validateEventProcessing(
  processorName,
  processorType,
  event,
  context,
);
if (shouldSkip === null) {
  // Processing should be skipped (already processed or has failures)
  return;
}

// CheckpointManager handles checkpoint operations
await checkpointManager.saveCheckpointSafely(
  processorName,
  processorType,
  event,
  "pending",
  sequenceNumber,
);
// ... process event ...
await checkpointManager.saveCheckpointSafely(
  processorName,
  processorType,
  event,
  "processed",
  sequenceNumber,
);
```

### Per-Aggregate Checkpointing

One checkpoint per aggregate tracks the last processed event with status tracking:

**Checkpoint Status:**
- **`pending`**: Event is queued but not yet processed
- **`processed`**: Event was successfully processed
- **`failed`**: Event processing failed

**Checkpoint Key:**
- Format: `tenantId:pipelineName:processorName:aggregateType:aggregateId`
- Key construction: Centralized in `buildCheckpointKey()` utility (see [`utils/checkpointKey.ts`](../langwatch/src/server/event-sourcing/library/utils/checkpointKey.ts))
- One checkpoint per aggregate (not per event)

**Checkpoint Data:**
- Processor name and type (handler/projection)
- Last processed event ID and timestamp
- Last processed sequence number (1-indexed)
- Status (pending/processed/failed)
- Processed/failed timestamps
- Error message (if failed)

**Benefits:**
- **Efficient storage**: One record per aggregate instead of one per event
- **Idempotency**: Already processed events are automatically skipped (check if last processed sequence >= current sequence)
- **Sequential ordering**: Events processed in sequence number order (check if previous sequence was processed)
- **Failure detection**: Failed events stop subsequent processing
- **Recovery**: Failed events can be identified and reprocessed

### Failure Handling

When an event fails processing:

1. **Checkpoint saved as `failed`**: Records failure with error message
2. **Subsequent events stop**: Events with higher sequence numbers for that aggregate will not be processed
3. **Recovery workflow**:
   - Identify failed events via `getFailedEvents()`
   - Fix underlying issue (code bug, data issue, external dependency)
   - Clear checkpoints for failed events via `clearCheckpoint()`
   - Events will be reprocessed automatically via queue retries

**Failure Detection:**
```typescript
// FailureDetector checks for failures before processing
const hasFailures = await failureDetector.hasFailedEvents(
  processorName,
  processorType,
  event,
);

if (hasFailures) {
  // Processing stops gracefully (storeEvents succeeds, but processing is skipped)
  return null; // Skip processing
}
```

## Concurrency Considerations

### Race Condition 1: Check-Then-Act in getProjection

**Severity: High**

**The Problem:**
```typescript
async getProjection(aggregateId: string) {
  let projection = await this.projectionStore.getProjection(aggregateId);
  if (!projection) {
    projection = await this.rebuildProjection(aggregateId); // RACE!
  }
  return projection;
}
```

Multiple processes can simultaneously:
1. Check projection doesn't exist
2. Both rebuild
3. Both write (duplicate work, possible conflicts)

**Impact:**
- Wasted computation
- Write conflicts
- Inconsistent state

**Mitigation Options:**

**Option 1: Accept Duplicate Work (Default)**
- Simplest approach
- Duplicate work is wasteful but usually safe
- Ensure projection store handles concurrent writes gracefully

**Option 2: Distributed Locking (Recommended for Production)**

Configure `EventSourcingService` with a distributed lock:

```typescript
import { EventSourcingService, RedisDistributedLock } from "./library";

const service = new EventSourcingService({
  // ... other options
  distributedLock: new RedisDistributedLock(redisClient),
  rebuildLockTtlMs: 5 * 60 * 1000, // 5 minutes
});

// rebuildProjection will automatically acquire a lock
await service.rebuildProjectionByName("summary", aggregateId, {
  tenantId: createTenantId("tenant"),
});
```

When a distributed lock is provided:
- Acquires lock with key: `rebuild:{tenantId}:{aggregateType}:{aggregateId}:{projectionName}`
- Throws error if lock cannot be acquired (another rebuild in progress)
- Automatically releases lock when rebuild completes

**Option 3: Optimistic Locking (Recommended for ProjectionStore)**

Implement version-based optimistic locking in your projection store:

```typescript
class VersionedProjectionStore implements ProjectionStore {
  async storeProjection(projection: Projection, context: ProjectionStoreWriteContext) {
    const result = await this.db.execute(`
      UPDATE projections
      SET data = ?, version = ?
      WHERE aggregate_id = ? AND tenant_id = ? AND (version IS NULL OR version < ?)
    `, [
      projection.data,
      projection.version,
      projection.aggregateId,
      context.tenantId,
      projection.version
    ]);

    if (result.rowsAffected === 0) {
      const existing = await this.getProjection(projection.aggregateId, context);
      throw new OptimisticLockError(existing);
    }
  }
}
```

### Race Condition 2: Concurrent Batch Rebuilds

**Severity: High**

**The Problem:**
```
Worker 1: listAggregateIds() -> [agg-1, agg-2, agg-3]
Worker 2: listAggregateIds() -> [agg-1, agg-2, agg-3]  // Same!

Both rebuild agg-1, agg-2, agg-3 simultaneously
```

**Mitigation Options:**

**Option 1: Single Worker**
- Only run batch rebuilds from one worker
- Use cron job or scheduled task

**Option 2: Distributed Locking (Automatic if configured)**
If the service is configured with a `distributedLock`, each call to `rebuildProjectionByName` (called internally by batch operations) will automatically acquire a lock:

```typescript
const service = new EventSourcingService({
  distributedLock: new RedisDistributedLock(redisClient),
});

// Each rebuildProjectionByName call will acquire/release locks automatically
await service.rebuildProjectionsInBatches({
  batchSize: 100,
  eventStoreContext: { tenantId: createTenantId("tenant") },
  projectionStoreContext: { tenantId: createTenantId("tenant") },
});
```

**Option 3: Partition by Tenant**
```typescript
// Worker 1: tenants A-M, Worker 2: tenants N-Z
await service.rebuildProjectionsInBatches({
  eventStoreContext: { tenantId: createTenantId(myAssignedTenants) },
  projectionStoreContext: { tenantId: createTenantId(myAssignedTenants) },
});
```

### Race Condition 3: Non-Atomic Hook Execution

**Severity: Medium**

**The Problem:**
```typescript
await hooks.beforePersist(projection);
await store.storeProjection(projection);  // Succeeds
await hooks.afterPersist(projection);      // Throws - partial success!
```

**Impact:** If `afterPersist` throws, projection IS persisted but post-processing failed.

**Mitigation:**
- Make hooks idempotent
- Don't throw in afterPersist unless truly exceptional
- Use afterPersist for "best effort" side effects
- Or implement compensating transactions

### Race Condition 4: Last Write Wins

**Severity: High**

**The Problem:**
```typescript
// Process 1 and 2 both fetch events
Process 1: rebuild -> projection v1
Process 2: rebuild -> projection v2

// Both write (last wins)
Process 1: storeProjection(v1)  // Written
Process 2: storeProjection(v2)  // Overwrites v1 - LOST!
```

**Mitigation:** Implement optimistic locking in your projection store (see Option 3 above).

### Race Condition 5: Out-of-Order Event Processing

**Severity: High (Mitigated by Sequential Ordering)**

**The Problem (Before Sequential Ordering):**
```typescript
// Events arrive out of order
Event 3 (seq: 3) arrives first → processed
Event 1 (seq: 1) arrives second → processed
Event 2 (seq: 2) arrives third → processed

// Result: Projection built from events in wrong order!
```

**Mitigation: Sequential Ordering Enforcement**

The system now enforces sequential processing:
- Event N cannot be processed until event N-1 is processed
- Sequence numbers are computed deterministically
- Checkpoints track processing status per event
- Out-of-order processing is prevented at the checkpoint level

**How it works:**
1. Event arrives and sequence number is computed
2. System checks if previous sequence number was processed
3. If not, processing stops with error (queue will retry)
4. Once previous event is processed, current event can proceed

### Concurrency Checklist

- [ ] Understand `getProjection` check-then-act race condition
- [ ] Projection store handles concurrent writes gracefully
- [ ] Configure `distributedLock` in production to prevent concurrent rebuilds
- [ ] Batch rebuilds coordinated (single worker or distributed locking)
- [ ] Hooks are idempotent and document error handling
- [ ] Consider optimistic locking for projection stores
- [ ] Test concurrent access patterns
- [ ] Sequential ordering enforced via checkpoints (automatic)
- [ ] Per-aggregate checkpoints enable idempotency (automatic)
- [ ] Failure detection stops cascading failures (automatic)

## Implementation Patterns

### Implementing EventStore

**Required Methods:**
- `getEvents(aggregateId, context, aggregateType)`: Query events for an aggregate
- `storeEvents(events, context, aggregateType)`: Store events

**Template:**
```typescript
import {
  EventStore,
  EventUtils,
  type AggregateType,
  type EventStoreReadContext,
  type EventStoreWriteContext,
} from "./library";

class MyEventStore implements EventStore<string, MyEvent> {
  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<string, MyEvent>,
    aggregateType: AggregateType,
  ): Promise<readonly MyEvent[]> {
    // CRITICAL: Validate tenant
    EventUtils.validateTenantId(context, "getEvents");

    // Query with tenant isolation
    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ? AND aggregate_type = ? ORDER BY timestamp ASC",
      [aggregateId, context.tenantId, aggregateType]
    );
  }

  async storeEvents(
    events: readonly MyEvent[],
    context: EventStoreWriteContext<string, MyEvent>,
    aggregateType: AggregateType,
  ): Promise<void> {
    // CRITICAL: Validate tenant
    EventUtils.validateTenantId(context, "storeEvents");

    // Validate all events
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(`[SECURITY] Invalid event: ${JSON.stringify(event)}`);
      }
    }

    // Ensure all events belong to same tenant
    const tenantIds = new Set(events.map(e => e.tenantId));
    if (tenantIds.size !== 1 || !tenantIds.has(context.tenantId)) {
      throw new Error("[SECURITY] All events must belong to context tenant");
    }

    // Store events
    await this.db.insert(
      events.map((event) => ({
        ...event,
        tenant_id: context.tenantId,
        aggregate_type: aggregateType,
      }))
    );
  }
}
```

**Key Points:**
- Always validate tenant ID before any operation
- Always filter queries by tenant ID
- Validate events before storing
- Ensure events belong to context tenant

### Implementing ProjectionStore

**Required Methods:**
- `getProjection(aggregateId, context)`: Get projection for an aggregate
- `storeProjection(projection, context)`: Store projection

**Template:**
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
    // CRITICAL: Validate tenant
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
    // CRITICAL: Validate tenant
    EventUtils.validateTenantId(context, "storeProjection");

    // Validate projection
    if (!EventUtils.isValidProjection(projection)) {
      throw new Error("[SECURITY] Invalid projection");
    }

    // Ensure projection belongs to context tenant
    if (projection.tenantId !== context.tenantId) {
      throw new Error("[SECURITY] Projection tenant must match context tenant");
    }

    // Store projection (upsert with version for optimistic locking)
    await this.db.upsert({
      aggregate_id: projection.aggregateId,
      tenant_id: context.tenantId,
      data: projection.data,
      version: projection.version,
    });
  }
}
```

**Key Points:**
- Always validate tenant ID
- Validate projection structure
- Ensure projection belongs to context tenant
- Consider optimistic locking via version field

### Implementing EventHandler (Projection Builder)

**Purpose:** Builds projections from event streams

**Interface:**
```typescript
interface EventHandler<EventType extends Event, ProjectionType extends Projection> {
  handle(stream: EventStream<EventType["tenantId"], EventType>): ProjectionType | Promise<ProjectionType>;
}
```

**Template:**
```typescript
import type { EventHandler, EventStream } from "./library";
import { createTenantId } from "./library";

class MyProjectionHandler implements EventHandler<MyEvent, MyProjection> {
  handle(stream: EventStream<TenantId, MyEvent>): MyProjection {
    const events = stream.getEvents();
    const metadata = stream.getMetadata();

    // Build projection from events
    const data = this.buildProjectionData(events);

    return {
      id: stream.getAggregateId(),
      aggregateId: stream.getAggregateId(),
      tenantId: stream.getTenantId(),
      version: metadata.lastEventTimestamp ?? Date.now(),
      data,
    };
  }

  private buildProjectionData(events: readonly MyEvent[]): MyProjectionData {
    // Your domain logic here
    return { /* ... */ };
  }
}
```

**Key Points:**
- Events are already sorted (by timestamp or custom ordering)
- Use `stream.getMetadata()` for event count, timestamps, etc.
- Return projection with correct tenant ID from stream
- Use last event timestamp or current time for version

### Implementing EventReactionHandler (Side Effects)

**Purpose:** Reacts to individual events for side effects (write to ClickHouse, trigger other processes)

**Interface:**
```typescript
interface EventReactionHandler<EventType extends Event> {
  handle(event: EventType): Promise<void>;
  getEventTypes?(): string[] | undefined;
}
```

**Template:**
```typescript
import type { EventReactionHandler } from "./library";

class MyEventReactionHandler implements EventReactionHandler<MyEvent> {
  constructor(private repository: MyRepository) {}

  getEventTypes(): string[] {
    return ["my.event.type"]; // Optional: filter by event type
  }

  async handle(event: MyEvent): Promise<void> {
    // Perform side effect (idempotent)
    await this.repository.write(event.data);
  }
}
```

**Key Points:**
- Handlers should be idempotent (safe to retry)
- Use `getEventTypes()` to filter events (optional)
- Handle errors gracefully (framework logs but doesn't fail dispatch)
- Don't throw unless truly exceptional (affects other handlers)
- Sequential ordering is enforced automatically by the framework (via `EventProcessorValidator`)
- Per-aggregate checkpoints enable idempotency automatically (via `CheckpointManager`)

### Implementing ProcessorCheckpointStore

**Purpose:** Tracks per-aggregate processing status for both handlers and projections (one checkpoint per aggregate tracks last processed event)

**Interface:**
```typescript
interface ProcessorCheckpointStore {
  saveCheckpoint(
    checkpointKey: string, // Format: tenantId:pipelineName:processorName:aggregateType:aggregateId
    processorType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void>;

  loadCheckpoint(
    checkpointKey: string, // Format: tenantId:pipelineName:processorName:aggregateType:aggregateId
  ): Promise<ProcessorCheckpoint | null>;

  getCheckpointBySequenceNumber(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    sequenceNumber: number,
  ): Promise<ProcessorCheckpoint | null>;

  hasFailedEvents(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<boolean>;

  getFailedEvents(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint[]>;
}
```

**Template:**
```typescript
import {
  ProcessorCheckpointStore,
  EventUtils,
  buildCheckpointKey,
  type Event,
  type ProcessorCheckpoint,
  type TenantId,
  type AggregateType,
} from "./library";

class MyProcessorCheckpointStore implements ProcessorCheckpointStore {
  async saveCheckpoint<EventType extends Event>(
    checkpointKey: string, // Format: tenantId:pipelineName:processorName:aggregateType:aggregateId
    processorType: "handler" | "projection",
    event: EventType,
    status: "processed" | "failed" | "pending",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void> {
    // CRITICAL: Validate tenant
    EventUtils.validateTenantId(
      { tenantId: event.tenantId },
      "ProcessorCheckpointStore.saveCheckpoint",
    );

    // checkpointKey is provided (constructed by CheckpointManager using buildCheckpointKey)
    const now = Date.now();

    await this.db.upsert({
      checkpoint_key: checkpointKey,
      processor_type: processorType,
      event_id: event.id,
      status,
      event_timestamp: event.timestamp,
      sequence_number: sequenceNumber,
      processed_at: status === "processed" ? now : null,
      failed_at: status === "failed" ? now : null,
      error_message: status === "failed" ? errorMessage : null,
      tenant_id: event.tenantId,
      aggregate_type: event.aggregateType,
      aggregate_id: String(event.aggregateId),
    });
  }

  async loadCheckpoint(
    checkpointKey: string, // Format: tenantId:pipelineName:processorName:aggregateType:aggregateId
  ): Promise<ProcessorCheckpoint | null> {
    const record = await this.db.findOne({ checkpoint_key: checkpointKey });
    if (!record) return null;

    return {
      processorName: record.processor_name,
      processorType: record.processor_type,
      eventId: record.event_id,
      status: record.status,
      eventTimestamp: record.event_timestamp,
      sequenceNumber: record.sequence_number,
      processedAt: record.processed_at ?? void 0,
      failedAt: record.failed_at ?? void 0,
      errorMessage: record.error_message ?? void 0,
      tenantId: record.tenant_id as TenantId,
      aggregateType: record.aggregate_type as AggregateType,
      aggregateId: record.aggregate_id,
    };
  }

  async getCheckpointBySequenceNumber(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
    sequenceNumber: number,
  ): Promise<ProcessorCheckpoint | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStore.getCheckpointBySequenceNumber",
    );

    // Load aggregate checkpoint and check if last processed sequence >= requested sequence
    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );
    const checkpoint = await this.loadCheckpoint(checkpointKey);

    if (!checkpoint || checkpoint.status !== "processed") {
      return null;
    }

    // Check if last processed sequence number is >= requested sequence number
    if (checkpoint.sequenceNumber >= sequenceNumber) {
      return checkpoint;
    }

    return null;
  }

  async hasFailedEvents(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<boolean> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStore.hasFailedEvents",
    );

    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );
    const checkpoint = await this.loadCheckpoint(checkpointKey);

    return checkpoint?.status === "failed";
  }

  async getFailedEvents(
    pipelineName: string,
    processorName: string,
    processorType: "handler" | "projection",
    tenantId: TenantId,
    aggregateType: AggregateType,
    aggregateId: string,
  ): Promise<ProcessorCheckpoint[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "ProcessorCheckpointStore.getFailedEvents",
    );

    const checkpointKey = buildCheckpointKey(
      tenantId,
      pipelineName,
      processorName,
      aggregateType,
      aggregateId,
    );
    const checkpoint = await this.loadCheckpoint(checkpointKey);

    if (checkpoint?.status === "failed") {
      return [checkpoint];
    }

    return [];
  }
}
```

**Key Points:**
- Always validate tenant ID before any operation
- Checkpoint key format: `tenantId:pipelineName:processorName:aggregateType:aggregateId` (use `buildCheckpointKey()` utility)
- One checkpoint per aggregate (not per event)
- Track last processed sequence number for sequential ordering enforcement
- Support status transitions: pending → processed/failed
- Filter queries by tenant ID, aggregate type, and aggregate ID
- Use sequence numbers to verify previous events were processed

### Implementing CommandHandler

**Purpose:** Processes commands and produces events

**Template:**
```typescript
import type { Command, CommandHandler } from "./library";
import { defineCommandSchema, EventUtils } from "./library";

class MyCommandHandler implements CommandHandler<Command<MyPayload>, MyEvent> {
  static readonly dispatcherName = "myCommand" as const;
  static readonly schema = defineCommandSchema<MyPayload>(
    "my.command.type",
    (payload): payload is MyPayload => {
      // Validation logic
      return payload.id !== undefined && payload.data !== undefined;
    }
  );

  static getAggregateId(payload: MyPayload): string {
    return payload.id;
  }

  static makeJobId(payload: MyPayload): string {
    return `${payload.tenantId}:${payload.id}`; // Optional: for idempotency
  }

  static getSpanAttributes(payload: MyPayload) {
    return { "payload.id": payload.id }; // Optional: for observability
  }

  async handle(command: Command<MyPayload>): Promise<MyEvent[]> {
    // Validate and create events
    const event = EventUtils.createEventWithProcessingTraceContext(
      command.aggregateId,
      command.tenantId,
      "my.event.type",
      {
        // Event data
      }
    );

    return [event];
  }
}
```

**Key Points:**
- Schema validates payload structure
- `getAggregateId` extracts aggregate ID from payload
- `makeJobId` enables idempotency (optional)
- `getSpanAttributes` adds observability (optional)
- Handler returns events to be stored

## Observability Patterns

### Tracing

**Service-level spans:**
```typescript
private readonly tracer = getLangWatchTracer("langwatch.event-sourcing.service");

await this.tracer.withActiveSpan("EventSourcingService.rebuildProjection", {
  kind: SpanKind.INTERNAL,
  attributes: {
    "aggregate.id": String(aggregateId),
    "tenant.id": context.tenantId,
    "event.count": metadata.eventCount,
  },
}, async (span) => {
  span.addEvent("event_store.fetch.start");
  const events = await this.eventStore.getEvents(aggregateId, context, aggregateType);
  span.addEvent("event_store.fetch.complete", { "event.count": events.length });
  // ...
});
```

**Store-level spans:**
```typescript
tracer = getLangWatchTracer("langwatch.my-store");

async getEvents(aggregateId: string, context: EventStoreReadContext) {
  await this.tracer.withActiveSpan("MyEventStore.getEvents", {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tenant.id": context.tenantId,
      "aggregate.id": aggregateId,
    },
  }, async () => {
    // Query logic
  });
}
```

**Naming conventions:**
- Classes: `"langwatch.domain.subdomain.class-name"`
- Methods: `ClassName.methodName`
- Attributes: Use dot notation (`"tenant.id"`, `"aggregate.id"`)

### Logging

**Structured logging with Pino:**
```typescript
private readonly logger = createLogger("langwatch:event-sourcing:service");

this.logger.info(
  {
    aggregateId: String(aggregateId),
    tenantId: context.tenantId,
    eventCount: metadata.eventCount,
  },
  "Starting projection rebuild"
);

this.logger.error(
  {
    aggregateId: String(aggregateId),
    error: error instanceof Error ? error.message : String(error),
  },
  "Failed to rebuild projection"
);
```

**Naming conventions:**
- Logger names: `"langwatch:domain:subdomain:resource"` (kebab-case with colons)
- Log properties: camelCase
- Never log PII or sensitive data

## Testing Patterns

### Unit Testing Stores

```typescript
import { EventStoreMemory, ProjectionStoreMemory } from "../stores";
import { createTenantId } from "./library";

describe("MyEventStore", () => {
  it("should enforce tenant isolation", async () => {
    const store = new MyEventStore();
    const tenant1 = createTenantId("tenant1");
    const tenant2 = createTenantId("tenant2");

    await store.storeEvents([event1], { tenantId: tenant1 }, "my-type");
    await store.storeEvents([event2], { tenantId: tenant2 }, "my-type");

    const events1 = await store.getEvents("agg-1", { tenantId: tenant1 }, "my-type");
    expect(events1).toHaveLength(1);
    expect(events1[0].tenantId).toBe(tenant1);

    const events2 = await store.getEvents("agg-1", { tenantId: tenant2 }, "my-type");
    expect(events2).toHaveLength(1);
    expect(events2[0].tenantId).toBe(tenant2);
  });

  it("should reject cross-tenant access", async () => {
    const store = new MyEventStore();
    const tenant1 = createTenantId("tenant1");
    const tenant2 = createTenantId("tenant2");

    await store.storeEvents([event1], { tenantId: tenant1 }, "my-type");

    await expect(
      store.getEvents("agg-1", { tenantId: tenant2 }, "my-type")
    ).rejects.toThrow();
  });
});
```

### Testing Checklist

- [ ] Test malformed event/projection rejection
- [ ] Test missing/empty tenantId throws [SECURITY] errors
- [ ] Test cross-tenant access attempts throw errors
- [ ] Test concurrent projection rebuilds
- [ ] Test hook error recovery
- [ ] Test batch processing failures and resumption
- [ ] Test edge cases (empty streams, null data, NaN timestamps)

## Summary

The event sourcing library provides:
- **Type-safe abstractions**: Event, Projection, EventStream, Stores
- **Multi-tenant isolation**: Branded TenantId type and validation utilities
- **Concurrency control**: Distributed locking and optimistic locking patterns
- **Sequential ordering**: Per-aggregate ordering enforcement via sequence numbers and checkpoints
- **Per-aggregate checkpointing**: One checkpoint per aggregate tracks last processed event (key: `tenantId:pipelineName:processorName:aggregateType:aggregateId`)
- **Modular service architecture**: EventProcessorValidator, CheckpointManager, QueueProcessorManager, EventHandlerDispatcher, ProjectionUpdater
- **Observability**: OpenTelemetry tracing and structured logging
- **Extensibility**: Hooks, custom ordering, pluggable stores
- **Error handling**: Standardized error categorization (ErrorCategory enum)

**Critical Requirements:**
1. Always validate tenant ID before any store operation
2. Always filter queries by tenant ID
3. Validate inputs before storing
4. Handle concurrency (distributed locking or optimistic locking)
5. Make handlers idempotent
6. Sequential ordering is enforced automatically via checkpoints (EventProcessorValidator)
7. Processor checkpoint stores track per-aggregate status (one checkpoint per aggregate)

**Key Features:**
- **Sequence numbers**: Events are numbered 1, 2, 3, ... in chronological order per aggregate (SequenceNumberCalculator)
- **Sequential processing**: Events must be processed in sequence number order (OrderingValidator)
- **Per-aggregate checkpoints**: One checkpoint per aggregate tracks last processed event (CheckpointManager)
- **Failure detection**: Failed events stop processing of subsequent events for that aggregate (FailureDetector)
- **Idempotency**: Already processed events are automatically skipped (IdempotencyChecker)
- **Validation orchestration**: EventProcessorValidator coordinates all validation components

For quick start examples, see the [README](../langwatch/src/server/event-sourcing/library/README.md). For runtime architecture, see [Runtime Documentation](./05-event-sourcing-runtime.md).
