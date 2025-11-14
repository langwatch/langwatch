---
title: "Event-Sourced Trace Processing Library"
description: "How the reusable event-streaming primitives structure trace projections and other aggregates."
---

## Overview

- The `trace-processing/library` folder now owns all event-sourcing primitives (`core/`, `stores/`, `processing/`, `services/`, `utils/`).
- `createEventSourcingPipeline` wires an `EventStore`, `ProjectionStore`, and `EventHandler` into a fully typed `EventSourcingService`.
- `EventStream` normalizes ordering, metadata, and late-arriving spans before handlers compute projections.

## Key Components

<Steps>
<Step title="EventStream + metadata">
  `core/eventStream.ts` sorts events (timestamp or custom comparator) and provides derived metadata (count, first/last timestamps). Handlers consume `EventStream` instead of raw arrays, which removes ordering logic from features.
</Step>

<Step title="Context-aware stores">
  Both `EventStore` and `ProjectionStore` accept read/write context (tenant IDs, metadata). Trace consumers pass `{ eventStoreContext, projectionStoreContext }`, enabling multi-tenant ClickHouse queries without baking tenancy into aggregate IDs.
</Step>

<Step title="Hooks & lifecycle">
  `EventSourcingService` supports `EventSourcingHooks` (before/after handle + persist) and ordering strategies via `EventSourcingOptions`. Hooks can emit telemetry or mutate projection metadata without forking the service.
</Step>

<Step title="Pipeline factory">
  `createEventSourcingPipeline` centralizes instantiation so features only supply concrete stores + handler. You can swap ClickHouse with in-memory stores for tests without touching consumers.
</Step>
</Steps>

## Using the pipeline

```ts
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

## Extensibility Points

- **Ordering:** pass custom comparators (e.g., priority queues) when constructing the service.
- **Hooks:** attach instrumentation, observability counters, or cache invalidations without modifying handlers.
- **Stores:** implement memory, ClickHouse, or hybrid stores by conforming to the typed interfaces; contexts handle env-specific data.
- **Handlers:** operate on an `EventStream`, giving access to metadata + helper utilities (`buildProjectionMetadata`, `createEventStream`, etc.).

<Tip>
Keep feature folders thin: instantiate the generic pipeline, then focus on domain heuristics (input/output detection, TTFT, etc.) inside feature utilities.
</Tip>

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

<Info>
The worker limiter (10 jobs/sec) and exponential backoff (3 retries starting at 2s) ensure we don't saturate ClickHouse during burst ingestion. Failed jobs move to the DLQ after retries for manual inspection.
</Info>

## Telemetry & Observability

All services, stores, and consumers emit OpenTelemetry spans:
- **EventSourcingService** creates spans for `rebuildProjection`, `getProjection`, `forceRebuildProjection` with aggregate IDs + event counts.
- **ClickHouse stores** wrap queries/inserts in spans with tenant/trace IDs and emit events (`projection.job.enqueued`, `projection.not_found`, etc.).
- **BullMQ workers** use `bullmq-otel` for automatic job tracing.

Check the observability platform for:
- `EventSourcingService.*` spans to monitor projection rebuild latency
- `projection.job.enqueued` events to track queue enqueue rate
- `ProjectionStoreClickHouse.*` spans for ClickHouse query performance

