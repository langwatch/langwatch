---
title: "Event sourcing library: commands, processing trace context, and bulk reprocessing"
description: "Overview of the generic event sourcing library used in trace processing, including commands, processing-trace metadata, and bulk projection rebuild patterns."
---

### Overview

The trace-processing subsystem uses a small, generic event sourcing library under `src/server/features/trace-processing/library`.
This library is designed to be **domain-agnostic** (usable for traces, users, etc.) and now includes:

- **Events and projections**: Core types and helpers for event streams and projections.
- **Commands**: A generic way to represent intent that produces events.
- **Processing-trace context**: Optional metadata to link events to the pipeline’s own OpenTelemetry trace.
- **Bulk reprocessing**: APIs to scan aggregates and rebuild projections in batches with checkpoints.

This document explains the patterns and how they relate to trace/ span reprocessing workflows.

### Commands

Commands model “what should happen” before events are written.

- `core/command.ts` defines:
  - `Command<AggregateId, Payload, Metadata>`
  - `CommandHandler<AggregateId, CommandType>`
  - `CommandHandlerResult`
  - `createCommand(aggregateId, type, data, metadata?)`
- The library does **not** dictate how commands are transported (HTTP, queues, etc.); it only provides the types so domain code can:
  - Validate commands.
  - Decide which events to emit for each command.

Use commands in feature modules (e.g. trace processing) to formalize the contract between callers and event producers without coupling to infrastructure.

### Processing-trace metadata on events

Events now support a standardized metadata shape:

- `EventMetadataBase` (in `core/types.ts`) is the default metadata type for `Event` and includes:
  - `processingTraceparent?: string`
  - An index signature for additional metadata.
- **Important semantics**:
  - `processingTraceparent` refers to the **OpenTelemetry trace of the processing pipeline itself** (ingestion jobs, reprocessing jobs, etc.).
  - It is **not** the tenant/user trace ID being modeled in stored spans.
  - It is **optional**; domains that do not need this correlation can ignore it.

To attach processing-trace context, the library exposes helpers in `utils/event.utils.ts`:

- `createEvent(...)`: basic event constructor; does **not** attach any OTel context.
- `createEventWithProcessingTraceContext(...)`:
  - Derives the current active span via `@opentelemetry/api`.
  - Produces a W3C `traceparent` string.
  - Writes it to `metadata.processingTraceparent` if not already present.
  - If there is no active span and no other metadata, it leaves `metadata` undefined.
- Backwards compatibility:
  - `createEventWithTraceContext` is retained as a thin alias, but new code should use `createEventWithProcessingTraceContext`.

This pattern makes it easy to answer: “Which ingestion/reprocessing run produced this event/projection?” by following `processingTraceparent` back into LangWatch/OTel traces.

### Event store scanning and bulk reprocessing

To support large-scale reprocessing (e.g. “rebuild all traces for a tenant” or “rebuild since time T”), the library introduces scanning primitives on the event store and a bulk rebuild API on the service.

#### Event store scanning

`stores/eventStore.ts` now defines:

- `EventStoreListCursor` – an opaque cursor type (implementations can encode whatever state they need).
- `ListAggregateIdsResult<AggregateId>` – `{ aggregateIds, nextCursor? }`.
- `ReadOnlyEventStore` optionally exposes:
  - `listAggregateIds?(context?, cursor?, limit?): Promise<ListAggregateIdsResult<AggregateId>>`.

Key points:

- `listAggregateIds` is **optional** at the type level so existing stores compile.
- `EventSourcingService.rebuildProjectionsInBatches` checks at runtime and throws a clear error if the store does not support scanning.
- Filtering is driven by `EventStoreReadContext` (already includes `tenantId`, `metadata`, `raw`), so:
  - “Reprocess all” → call with an empty context.
  - “By tenant” → set `tenantId`.
  - “By trace IDs” or “since timestamp” → pass domain-specific filters through `metadata` / `raw` and implement them in the concrete store.

#### Bulk projection rebuild

`services/eventSourcingService.ts` adds:

- `BulkRebuildCheckpoint<AggregateId>`:
  - `cursor?: EventStoreListCursor`
  - `lastAggregateId?: AggregateId`
  - `processedCount: number`
- `BulkRebuildProgress<AggregateId>`:
  - `{ checkpoint: BulkRebuildCheckpoint<AggregateId> }`
- `BulkRebuildOptions<AggregateId, EventType>`:
  - `batchSize?`
  - `eventStoreContext?`
  - `projectionStoreContext?`
  - `resumeFrom?: BulkRebuildCheckpoint<AggregateId>`
  - `onProgress?(progress): Promise<void> | void`
- `rebuildProjectionsInBatches(options?)`:
  - Uses `eventStore.listAggregateIds(context, cursor, batchSize)` to fetch aggregate IDs in pages.
  - For each aggregate ID, calls `rebuildProjection` (which uses the existing handler and projection store).
  - Updates the checkpoint (`cursor`, `lastAggregateId`, `processedCount`) as it goes.
  - Invokes `onProgress` after each aggregate if provided.
  - Returns the final `BulkRebuildCheckpoint`.
  - Throws if the underlying store does not implement `listAggregateIds`.

This API is the building block for:

- One-off **“rebuild everything”** jobs.
- Tenant-scoped rebuilds.
- Targeted rebuilds (e.g. specific traces).
- Time-window-based rebuilds (e.g. “since last Tuesday”).

### Observability of the processing pipeline

The `EventSourcingService` uses the LangWatch tracer to wrap key operations:

- `rebuildProjection`, `getProjection`, `forceRebuildProjection`.
- `rebuildProjectionsInBatches`:
  - Starts a span named `EventSourcingService.rebuildProjectionsInBatches`.
  - Sets attributes such as:
    - `"batch.size"`
    - `"rebuild.processed_count"`
    - `"rebuild.last_aggregate_id"` (stringified when not already a string).

When `createEventWithProcessingTraceContext` is used in the same pipeline, events and projections can be correlated back to these spans using `processingTraceparent`.

### Usage guidance and trade-offs

- **When to use `processingTraceparent`**:
  - For ingestion, reprocessing, or migration jobs where you might later ask, “Which job created this state?”.
  - For debugging rare or complex issues where correlating stored state to pipeline traces is valuable.
- **When to skip it**:
  - For simple flows where the projections are easily reproducible and you primarily debug via logs or the current run’s spans.

The library deliberately keeps `processingTraceparent` optional and scoped to metadata, so each feature can decide how much processing-level observability it needs without affecting core event or projection shapes.

---

## Security Considerations

### Tenant Isolation

**CRITICAL:** When implementing `EventStore` and `ProjectionStore`, you MUST enforce tenant isolation in multi-tenant systems.

#### Requirements

1. **tenantId Validation**
   - Always validate that `context.tenantId` is provided
   - Reject operations that attempt to access data across tenant boundaries
   - The library now requires `tenantId` at the type level

2. **Query Filtering**
   - All queries MUST filter by tenant ID
   - Never allow queries that could leak data across tenants
   - Validate aggregate IDs belong to the requesting tenant
   - Use `validateTenantId(context, 'operationName')` before any store operations

3. **Write Validation**
   - Before storing events/projections, extract and validate tenant context
   - Ensure events cannot be stored with mismatched tenant identifiers
   - Consider using database-level row-level security for additional protection

#### Secure Implementation Example

```typescript
import { EventStore, EventUtils } from "./library";

class SecureEventStore implements EventStore<string, Event> {
  async getEvents(aggregateId: string, context: EventStoreReadContext) {
    // CRITICAL: Validate tenantId before ANY query
    EventUtils.validateTenantId(context, 'EventStore.getEvents');

    // Query with tenant isolation
    return await this.db.query(
      "SELECT * FROM events WHERE aggregate_id = ? AND tenant_id = ?",
      [aggregateId, context.tenantId]
    );
  }

  async storeEvents(events: readonly Event[], context: EventStoreWriteContext) {
    // CRITICAL: Validate tenantId before ANY write
    EventUtils.validateTenantId(context, 'EventStore.storeEvents');

    // Validate all events
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(`Invalid event: ${JSON.stringify(event)}`);
      }
    }

    // Ensure all events belong to same tenant
    const tenantIds = new Set(events.map(e => e.metadata?.tenantId));
    if (tenantIds.size !== 1 || !tenantIds.has(context.tenantId)) {
      throw new Error("All events must belong to context tenant");
    }

    await this.db.insert(events);
  }
}
```

### Aggregate ID Validation

**WARNING:** Using complex objects as aggregate IDs without proper `toString()` causes security issues.

#### The Problem

```typescript
// DANGEROUS: Both become "[object Object]"
const obj1 = { tenantId: "tenant1", id: "foo" };
const obj2 = { tenantId: "tenant2", id: "bar" };

const stream1 = new EventStream(obj1, events1);
const stream2 = new EventStream(obj2, events2);

// ID COLLISION!
stream1.getMetadata().aggregateId === stream2.getMetadata().aggregateId // "[object Object]"
```

This allows:
- Cross-tenant data access if stores use metadata.aggregateId for lookups
- Data corruption from ID collisions
- Security bypasses

#### The Solution

Use string or number aggregate IDs. If you must use objects, implement `toString()`:

```typescript
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

All store implementations MUST validate inputs using library utilities:

```typescript
import { EventUtils } from "./library";

class SecureEventStore implements EventStore {
  async storeEvents(events: readonly Event[]) {
    // Validate BEFORE storing
    for (const event of events) {
      if (!EventUtils.isValidEvent(event)) {
        throw new Error(`[SECURITY] Invalid event: ${JSON.stringify(event)}`);
      }
    }

    await this.db.insert(events);
  }
}
```

### Metadata Injection

The `raw` and `metadata` fields in contexts are for optimization hints only, NOT security bypasses.

**Don't:**
```typescript
// DANGEROUS: Using raw to bypass tenant checks
async getEvents(aggregateId, context) {
  if (context?.raw?.bypassSecurity) {
    return this.db.query("SELECT * FROM events WHERE aggregate_id = ?", [aggregateId]);
  }
  // ...
}
```

**Do:**
```typescript
// Safe: raw for optimization only
async getEvents(aggregateId, context) {
  EventUtils.validateTenantId(context, 'getEvents');
  const query = this.buildQuery(aggregateId, context.tenantId);

  // Use raw for hints, not security
  if (context?.raw?.useIndex) {
    query.useIndex(context.raw.useIndex);
  }

  return query.execute();
}
```

---

## Concurrency Considerations

### Race Condition 1: Check-Then-Act in getProjection

**High Severity**

The `EventSourcingService.getProjection` has a check-then-act race:

```typescript
async getProjection(aggregateId: string) {
  let projection = await this.projectionStore.getProjection(aggregateId);
  if (!projection) {
    projection = await this.rebuildProjection(aggregateId); // RACE!
  }
  return projection;
}
```

**Problem:** Multiple processes can simultaneously:
1. Check projection doesn't exist
2. Both rebuild
3. Both write (duplicate work, possible conflicts)

**Impact:**
- Wasted computation
- Write conflicts
- Inconsistent state

**Mitigation Options:**

Option 1: Accept Duplicate Work (Current Default)
- Simplest approach
- Duplicate work is wasteful but usually safe
- Ensure projection store handles concurrent writes gracefully

Option 2: Distributed Locking
```typescript
async getProjection(aggregateId: string) {
  return await this.lock.withLock(`projection:${aggregateId}`, async () => {
    let projection = await this.projectionStore.getProjection(aggregateId);
    if (!projection) {
      projection = await this.rebuildProjection(aggregateId);
    }
    return projection;
  });
}
```

Option 3: Optimistic Locking (Recommended)
```typescript
interface ProjectionStore {
  storeProjection(projection, context): Promise<{ success: boolean; conflict?: Projection }>;
}

// In rebuildProjection:
const result = await this.projectionStore.storeProjection(projection);
if (!result.success) {
  return result.conflict!; // Another process won
}
```

### Race Condition 2: Concurrent Batch Rebuilds

**High Severity**

Multiple workers calling `rebuildProjectionsInBatches` can process the same aggregates.

**Problem:**
```
Worker 1: listAggregateIds() -> [agg-1, agg-2, agg-3]
Worker 2: listAggregateIds() -> [agg-1, agg-2, agg-3]  // Same!

Both rebuild agg-1, agg-2, agg-3 simultaneously
```

**Mitigation Options:**

Option 1: Single Worker
- Only run batch rebuilds from one worker
- Use cron job or scheduled task

Option 2: Work Stealing with Locking
```typescript
async rebuildProjectionsInBatches() {
  for (const aggregateId of aggregateIds) {
    const lockAcquired = await this.tryLock(`rebuild:${aggregateId}`);
    if (lockAcquired) {
      try {
        await this.rebuildProjection(aggregateId);
      } finally {
        await this.releaseLock(`rebuild:${aggregateId}`);
      }
    }
  }
}
```

Option 3: Partition by Tenant
```typescript
// Worker 1: tenants A-M, Worker 2: tenants N-Z
await service.rebuildProjectionsInBatches({
  eventStoreContext: { tenantId: myAssignedTenants }
});
```

### Race Condition 3: Non-Atomic Hook Execution

**Medium Severity**

Hooks execute sequentially without transaction support:

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

**High Severity**

The `ProjectionStore.storeProjection` interface has no conflict detection:

```typescript
// Process 1 and 2 both fetch events
Process 1: rebuild -> projection v1
Process 2: rebuild -> projection v2

// Both write (last wins)
Process 1: storeProjection(v1)  // Written
Process 2: storeProjection(v2)  // Overwrites v1 - LOST!
```

**Mitigation:** Implement optimistic locking in your store:

```typescript
class VersionedProjectionStore implements ProjectionStore {
  async storeProjection(projection: Projection) {
    const result = await this.db.execute(`
      UPDATE projections
      SET data = ?, version = ?
      WHERE aggregate_id = ? AND (version IS NULL OR version < ?)
    `, [projection.data, projection.version, projection.aggregateId, projection.version]);

    if (result.rowsAffected === 0) {
      const existing = await this.getProjection(projection.aggregateId);
      throw new OptimisticLockError(existing);
    }
  }
}
```

---

## Implementation Checklists

### Security Checklist

- [ ] Call `EventUtils.validateTenantId()` in ALL store read/write methods
- [ ] Tenant isolation enforced in all store queries
- [ ] Input validation on all writes (use `isValidEvent`/`isValidProjection`)
- [ ] Aggregate IDs are strings/numbers or have proper `toString()`
- [ ] Metadata/raw fields don't bypass security checks
- [ ] Test cross-tenant access attempts (should throw)

### Concurrency Checklist

- [ ] Understand `getProjection` check-then-act race condition
- [ ] Projection store handles concurrent writes gracefully
- [ ] Batch rebuilds coordinated (single worker or distributed locking)
- [ ] Hooks are idempotent and document error handling
- [ ] Consider optimistic locking for projection stores
- [ ] Test concurrent access patterns

### Testing Checklist

- [ ] Test malformed event/projection rejection
- [ ] Test missing/empty tenantId throws [SECURITY] errors
- [ ] Test cross-tenant access attempts throw errors
- [ ] Test concurrent projection rebuilds
- [ ] Test hook error recovery
- [ ] Test batch processing failures and resumption
- [ ] Test edge cases (empty streams, null data, NaN timestamps, etc.)


