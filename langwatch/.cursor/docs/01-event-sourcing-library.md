---
title: "Event Sourcing Library: Architecture, Commands, and Trace Processing"
description: "Comprehensive guide to the generic event sourcing library used in trace processing, covering architecture, commands, event streams, bulk reprocessing, observability, security, and concurrency patterns."
---

## Overview

The trace-processing subsystem uses a small, generic event sourcing library under `src/server/features/trace-processing/library`.
This library is designed to be **domain-agnostic** (usable for traces, users, or any aggregate) and provides:

- **Events and projections**: Core types and helpers for event streams and projections.
- **Event streams**: Normalized ordering, metadata, and late-arriving event handling.
- **Commands**: A generic way to represent intent that produces events.
- **Pipeline factory**: `createEventSourcingPipeline` wires stores and handlers into a fully typed `EventSourcingService`.
- **Context-aware stores**: Both `EventStore` and `ProjectionStore` accept read/write context (tenant IDs, metadata) for multi-tenant isolation.
- **Hooks & lifecycle**: Before/after handle and persist hooks for telemetry and validation.
- **Processing-trace context**: Optional metadata to link events to the pipeline's own OpenTelemetry trace.
- **Bulk reprocessing**: APIs to scan aggregates and rebuild projections in batches with checkpoints.

This document explains the architecture, patterns, and how they relate to trace/span reprocessing workflows.

---

## Core Components

### EventStream

`core/eventStream.ts` provides the `EventStream` class that:
- Sorts events by timestamp or custom comparator
- Provides derived metadata (count, first/last timestamps)
- Removes ordering logic from feature handlers

Handlers consume `EventStream` instead of raw event arrays, which centralizes ordering and metadata computation.

```typescript
import { EventStream } from "../library";

// EventStream automatically sorts and provides metadata
const stream = new EventStream(aggregateId, events, { ordering: "timestamp" });

// Access metadata
const metadata = stream.getMetadata();
console.log(metadata.eventCount, metadata.firstEventTimestamp, metadata.lastEventTimestamp);

// Iterate events in order
for (const event of stream.events()) {
  // Process event
}
```

### Context-Aware Stores

Both `EventStore` and `ProjectionStore` accept read/write context for multi-tenant isolation:

```typescript
interface EventStoreReadContext<AggregateId = string, EventType = Event> {
  tenantId: string;  // Required for tenant isolation
  metadata?: Record<string, unknown>;  // Optional domain-specific filters
  raw?: any;  // Optional optimization hints
}
```

Trace consumers pass `{ eventStoreContext, projectionStoreContext }`, enabling multi-tenant ClickHouse queries without baking tenancy into aggregate IDs.

**Example:**
```typescript
await service.rebuildProjection(traceId, {
  eventStoreContext: { tenantId: "tenant_abc123" },
  projectionStoreContext: { tenantId: "tenant_abc123" },
});
```

### Hooks & Lifecycle

`EventSourcingService` supports `EventSourcingHooks` for extending the pipeline:

```typescript
interface EventSourcingHooks<AggregateId, EventType, ProjectionType> {
  beforeHandle?(stream, metadata): Promise<void> | void;
  afterHandle?(stream, projection, metadata): Promise<void> | void;
  beforePersist?(projection, metadata): Promise<void> | void;
  afterPersist?(projection, metadata): Promise<void> | void;
}
```

**Execution Order:** beforeHandle → handle → afterHandle → beforePersist → persist → afterPersist

Hooks can emit telemetry, validate projections, or mutate metadata without forking the service.

### Pipeline Factory

`createEventSourcingPipeline` centralizes instantiation:

```typescript
import { createEventSourcingPipeline } from "../library";

const { service } = createEventSourcingPipeline({
  eventStore: new EventStoreClickHouse(client),
  projectionStore: new ProjectionStoreClickHouse(client),
  eventHandler,
  serviceOptions: {
    ordering: "timestamp",
    hooks: myHooks,
  },
  logger: myLogger,  // Optional Pino logger
});
```

You can swap ClickHouse with in-memory stores for tests without touching consumers.

---

## Commands

Commands model "what should happen" before events are written.

`core/command.ts` defines:
- `Command<AggregateId, Payload, Metadata>`
- `CommandHandler<AggregateId, CommandType>`
- `CommandHandlerResult`
- `createCommand(aggregateId, type, data, metadata?)`

The library does **not** dictate how commands are transported (HTTP, queues, etc.); it only provides the types so domain code can:
- Validate commands.
- Decide which events to emit for each command.

Use commands in feature modules (e.g. trace processing) to formalize the contract between callers and event producers without coupling to infrastructure.

**Example:**
```typescript
import { createCommand } from "../library";

const command = createCommand(
  aggregateId,
  "UpdateTrace",
  { status: "completed" },
  { userId: "user_123" }
);

// Command handler decides which events to emit
const result = await commandHandler.handle(command);
```

---

## Using the Pipeline

### Basic Usage

```typescript
import {
  createEventSourcingPipeline,
  type EventHandler,
  type EventStream,
} from "../library";

const eventHandler: EventHandler<string, SpanEvent, TraceProjection> = {
  handle(stream: EventStream<string, SpanEvent>) {
    return buildTraceProjection(stream);
  },
};

const { service } = createEventSourcingPipeline({
  eventStore: new EventStoreClickHouse(client),
  projectionStore: new ProjectionStoreClickHouse(client),
  eventHandler,
  serviceOptions: {
    ordering: "timestamp",
  },
});

await service.rebuildProjection(traceId, {
  eventStoreContext: { tenantId },
  projectionStoreContext: { tenantId },
});
```

### Extensibility Points

- **Ordering:** Pass custom comparators (e.g., priority queues) when constructing the service.
- **Hooks:** Attach instrumentation, observability counters, or cache invalidations without modifying handlers.
- **Stores:** Implement memory, ClickHouse, or hybrid stores by conforming to the typed interfaces; contexts handle env-specific data.
- **Handlers:** Operate on an `EventStream`, giving access to metadata + helper utilities (`buildProjectionMetadata`, `createEventStream`, etc.).

**Tip:** Keep feature folders thin: instantiate the generic pipeline, then focus on domain heuristics (input/output detection, TTFT, etc.) inside feature utilities.

---

## Background Pipeline Architecture

The trace processing pipeline follows these stages:

1. **Span Ingestion** → `SpanIngestionWriteRepositoryClickHouse` writes spans to ClickHouse and enqueues projection jobs using the deduplicated job ID `{tenantId}:{traceId}`.
2. **Projection Queue** → BullMQ automatically deduplicates jobs per trace. Multiple spans arriving for the same trace collapse into a single projection job.
3. **Projection Worker** → Processes jobs with concurrency (`0.75 * CPU cores`) and rate limiting (`10 jobs/sec`) to prevent overwhelming ClickHouse.
4. **Projection Consumer** → Calls `service.rebuildProjection(traceId, { eventStoreContext, projectionStoreContext })`, which:
   - Queries all spans for the trace (from `EventStoreClickHouse`)
   - Builds an `EventStream` with ordered events
   - Runs domain heuristics via `TraceProjectionEventHandler`
   - Persists to `ProjectionStoreClickHouse` (ReplacingMergeTree dedupes by version)

**Note:** The worker limiter (10 jobs/sec) and exponential backoff (3 retries starting at 2s) ensure we don't saturate ClickHouse during burst ingestion. Failed jobs move to the DLQ after retries for manual inspection.

---

## Processing-Trace Metadata on Events

Events support a standardized metadata shape for correlating stored state to processing pipelines:

- `EventMetadataBase` (in `core/types.ts`) is the default metadata type for `Event` and includes:
  - `processingTraceparent?: string`
  - An index signature for additional metadata.

**Important semantics:**
- `processingTraceparent` refers to the **OpenTelemetry trace of the processing pipeline itself** (ingestion jobs, reprocessing jobs, etc.).
- It is **not** the tenant/user trace ID being modeled in stored spans.
- It is **optional**; domains that do not need this correlation can ignore it.

### Helpers in `utils/event.utils.ts`

- `createEvent(...)`: Basic event constructor; does **not** attach any OTel context.
- `createEventWithProcessingTraceContext(...)`:
  - Derives the current active span via `@opentelemetry/api`.
  - Produces a W3C `traceparent` string.
  - Writes it to `metadata.processingTraceparent` if not already present.
  - If there is no active span and no other metadata, it leaves `metadata` undefined.

This pattern makes it easy to answer: "Which ingestion/reprocessing run produced this event/projection?" by following `processingTraceparent` back into LangWatch/OTel traces.

### Usage Guidance

**When to use `processingTraceparent`:**
- For ingestion, reprocessing, or migration jobs where you might later ask, "Which job created this state?".
- For debugging rare or complex issues where correlating stored state to pipeline traces is valuable.

**When to skip it:**
- For simple flows where the projections are easily reproducible and you primarily debug via logs or the current run's spans.

The library deliberately keeps `processingTraceparent` optional and scoped to metadata, so each feature can decide how much processing-level observability it needs without affecting core event or projection shapes.

---

## Event Store Scanning and Bulk Reprocessing

To support large-scale reprocessing (e.g. "rebuild all traces for a tenant" or "rebuild since time T"), the library introduces scanning primitives on the event store and a bulk rebuild API on the service.

### Event Store Scanning

`stores/eventStore.ts` defines:

- `EventStoreListCursor` – An opaque cursor type (implementations can encode whatever state they need).
- `ListAggregateIdsResult<AggregateId>` – `{ aggregateIds, nextCursor? }`.
- `ReadOnlyEventStore` optionally exposes:
  - `listAggregateIds?(context?, cursor?, limit?): Promise<ListAggregateIdsResult<AggregateId>>`.

**Key points:**
- `listAggregateIds` is **optional** at the type level so existing stores compile.
- `EventSourcingService.rebuildProjectionsInBatches` checks at runtime and throws a clear error if the store does not support scanning.
- Filtering is driven by `EventStoreReadContext` (already includes `tenantId`, `metadata`, `raw`), so:
  - "Reprocess all" → Call with an empty context.
  - "By tenant" → Set `tenantId`.
  - "By trace IDs" or "since timestamp" → Pass domain-specific filters through `metadata` / `raw` and implement them in the concrete store.

### Bulk Projection Rebuild

`services/eventSourcingService.ts` provides:

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

### Use Cases

This API is the building block for:
- One-off **"rebuild everything"** jobs.
- Tenant-scoped rebuilds.
- Targeted rebuilds (e.g. specific traces).
- Time-window-based rebuilds (e.g. "since last Tuesday").

**Example:**
```typescript
const checkpoint = await service.rebuildProjectionsInBatches({
  batchSize: 100,
  eventStoreContext: { tenantId: "tenant_abc123" },
  projectionStoreContext: { tenantId: "tenant_abc123" },
  onProgress: async ({ checkpoint }) => {
    console.log(`Processed ${checkpoint.processedCount} aggregates`);
  },
});
```

---

## Observability

The event sourcing library and trace-processing features use OpenTelemetry tracing and structured logging extensively.

### EventSourcingService Tracing

The `EventSourcingService` creates spans for all key operations:

**Tracer initialization:**
```typescript
private readonly tracer = getLangWatchTracer("langwatch.trace-processing.event-sourcing-service");
private readonly logger?: Logger;
```

**Span naming pattern:** `EventSourcingService.methodName`
- `EventSourcingService.rebuildProjection`
- `EventSourcingService.getProjection`
- `EventSourcingService.forceRebuildProjection`
- `EventSourcingService.rebuildProjectionsInBatches`

**Span attributes:**
```typescript
attributes: {
  "aggregate.id": String(aggregateId),
  "tenant.id": options?.eventStoreContext?.tenantId ?? "missing",
  "event.count": metadata.eventCount,
  "projection.id": projection.id,
  "projection.version": projection.version,
  "batch.size": batchSize,
  "rebuild.processed_count": processedCount,
  "rebuild.last_aggregate_id": String(lastAggregateId),
}
```

**Span events for lifecycle steps:**
```typescript
span.addEvent("event_store.fetch.start");
const events = await this.eventStore.getEvents(aggregateId, context);
span.addEvent("event_store.fetch.complete");

span.addEvent("event_handler.handle.start");
const projection = await this.eventHandler.handle(stream);
span.addEvent("event_handler.handle.complete");

span.addEvent("hook.before_handle.start");
await hooks.beforeHandle(stream, metadata);
span.addEvent("hook.before_handle.complete");

span.addEvent("projection_store.store.start");
await this.projectionStore.storeProjection(projection, context);
span.addEvent("projection_store.store.complete");
```

### EventSourcingService Logging

Optional logger support (passed via constructor):

```typescript
this.logger?.info(
  {
    aggregateId: String(aggregateId),
    tenantId: options?.eventStoreContext?.tenantId ?? "missing",
  },
  "Starting projection rebuild"
);

this.logger?.debug(
  {
    aggregateId: String(aggregateId),
    eventCount: metadata.eventCount,
  },
  "Loaded events for projection rebuild"
);

this.logger?.info(
  {
    aggregateId: String(aggregateId),
    projectionId: projection.id,
    projectionVersion: projection.version,
    eventCount: metadata.eventCount,
    durationMs,
  },
  "Projection rebuild completed"
);

this.logger?.error(
  {
    aggregateId: String(aggregateId),
    error: error instanceof Error ? error.message : String(error),
    processedCount,
  },
  "Failed to rebuild projection for aggregate"
);
```

### Store Implementations

Concrete store implementations follow the same patterns. Example from `SpanIngestionWriteRepositoryClickHouse`:

```typescript
export class SpanIngestionWriteRepositoryClickHouse {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.repository.clickhouse");
  logger = createLogger("langwatch:span-ingestion:write:repository:clickhouse");

  async insertSpan(jobData: SpanIngestionWriteJob): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionWriteRepositoryClickHouse.insertSpan",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": jobData.tenantId,
          "span.id": jobData.spanData.spanId,
          "trace.id": jobData.spanData.traceId,
        },
      },
      async (span) => {
        try {
          const spanRecord = this.transformSpanData(jobData);
          span.setAttribute("langwatch.span.id", spanRecord.Id);

          await this.clickHouseClient.insert({
            table: "observability_spans",
            values: [spanRecord],
            format: "JSONEachRow",
          });
        } catch (error) {
          this.logger.error(
            {
              tenantId: jobData.tenantId,
              spanId: jobData.spanData.spanId,
              traceId: jobData.spanData.traceId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to insert span into ClickHouse",
          );
          throw error;
        }
      },
    );
  }
}
```

### Consumer Implementations

Example from `SpanIngestionWriteConsumerBullMq`:

```typescript
export class SpanIngestionWriteConsumerBullMq {
  tracer = getLangWatchTracer("langwatch.span-ingestion.write.consumer.bullmq");
  logger = createLogger("langwatch:span-ingestion:write:consumer:bullmq");

  async consume(jobData: SpanIngestionWriteJob): Promise<void> {
    await this.tracer.withActiveSpan(
      "SpanIngestionWriteConsumerBullMq.consume",
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "tenant.id": jobData.tenantId,
          "span.id": jobData.spanData.spanId,
          "trace.id": jobData.spanData.traceId,
          "collected_at_unix_ms": jobData.collectedAtUnixMs,
        },
      },
      async () => {
        this.logger.info({
          tenantId: jobData.tenantId,
          spanId: jobData.spanData.spanId,
          traceId: jobData.spanData.traceId,
          collectedAtUnixMs: jobData.collectedAtUnixMs,
        }, "Consuming span ingestion write job");

        await this.repository.insertSpan(jobData);
      },
    );
  }
}
```

### Observability Patterns Summary

**Tracer naming:**
- Classes: `"langwatch.domain.subdomain.class-name"`
- Files: `"langwatch.domain.subdomain.file-name"`

**Logger naming:**
- `"langwatch:domain:subdomain:resource"` (kebab-case with colons)

**Span naming:**
- `ClassName.methodName`
- `fileName.functionName`

**Attributes:**
- Use dot notation: `"tenant.id"`, `"aggregate.id"`, `"event.count"`
- Never snake_case or camelCase for attributes

**Events:**
- Use for lifecycle steps: `"operation.start"` / `"operation.complete"`
- Include context in event attributes when useful

**Logging:**
- Pino argument order: `logger.level({ data }, "message")`
- Use camelCase for log object properties
- Never log PII or sensitive data

### Monitoring Recommendations

Check the observability platform for:
- `EventSourcingService.*` spans to monitor projection rebuild latency
- `projection.not_found` events to track cache miss rate
- Store-level spans (e.g., `ProjectionStoreClickHouse.*`) for query performance
- Consumer spans for job processing throughput
- Log entries with `error` level for failures requiring attention

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

**Option 1: Accept Duplicate Work (Current Default)**
- Simplest approach
- Duplicate work is wasteful but usually safe
- Ensure projection store handles concurrent writes gracefully

**Option 2: Distributed Locking**
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

**Option 3: Optimistic Locking (Recommended)**
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

**Option 1: Single Worker**
- Only run batch rebuilds from one worker
- Use cron job or scheduled task

**Option 2: Work Stealing with Locking**
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

**Option 3: Partition by Tenant**
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
