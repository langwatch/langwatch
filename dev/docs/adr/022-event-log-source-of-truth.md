# ADR-022: The event log owns full trace content; projections stay lean

**Date:** 2026-04-13

**Status:** Accepted

**Related:** [projection replay](../../../packages/eventing/adrs/015-projection-replay-coordination.md),
[ClickHouse cached projections](../../../packages/eventing/adrs/066-clickhouse-cached-projections.md),
[content-addressed queue payloads](../../../packages/group-queue/adrs/029-content-addressed-payload-store.md),
and [gateway payload capture](./017-gateway-trace-payload-capture.md).

## Context

Trace events may contain large inputs, outputs and span attributes. Copying
their complete content into every projection and queue job makes Redis and
ClickHouse projection writes scale with payload size. Permanently offloading
individual fields to object storage would instead make replay and full reads
depend on a second durable authority.

The append-only event log already has the identity, tenant boundary and
retention policy required to own the full event. Projection rows need bounded
previews and a way to resolve the full value only when a caller asks for it.

## Decision

`event_log` is the durable source of truth for full trace event content.
Object storage is a transient spool used only to protect command transport
from an oversized serialized payload.

### Edge transport is bounded

When a serialized command exceeds `COMMAND_INLINE_THRESHOLD` (256 KiB), the
edge writes the complete span payload to the deployment's object store and
queues an opaque spool marker. The command worker reads the spool, appends the
full event to `event_log`, and eagerly deletes the object after the waited
append succeeds.

The marker does not carry a bucket, raw object key or tenant-controlled
location. The worker derives the spool path from the authenticated tenant,
trace and span identities. Each dynamic path component is either restricted to
`[A-Za-z0-9_-]` or replaced by a deterministic hash before it reaches a
storage driver.

Spool writes use the object-store capability already injected into the trace
pipeline, so S3 and Azure Blob follow the deployment's configured destination
without importing Stored Objects. A local-filesystem destination is refused
because it cannot provide the lifecycle policy that reaps objects left by a
crash between write and delete. Trace spooling retains its own transient
lifecycle.

The spool prefix has a three-day provider lifecycle rule as an orphan safety
net. Azure writes require the deployment assertion that this management-plane
policy exists. That assertion gates writes only; reads and deletes remain
available so changing configuration cannot strand in-flight objects.

A spool write failure is fail-open: ingestion logs the loss of oversize
protection and sends the full inline command. A spool read failure is
retryable and must not silently create a content-free event.

### One interposition derives the projection shape

After the full event append and before live projection dispatch,
`leanForProjection(event)` replaces over-threshold IO values with:

- a bounded preview up to `IO_PREVIEW_BYTES` (64 KiB by default); and
- a server-owned `langwatch.reserved.eventref.<attribute>` marker naming the
  field within the same event.

The event identity is implicit in the projection row; the marker does not
repeat a storage URI. Event types without heavy fields pass through unchanged.

Live delivery and replay call the same interposition. Projection state is
therefore byte-identical whether it is produced from a queued event or rebuilt
from the canonical log.

```text
full command
  -> optional transient spool
  -> waited full event_log append
  -> leanForProjection
  -> Group Queue
       -> ClickHouse map/fold projections
       -> projection subscribers
```

### Reads choose the store by intent

- list, search and collapsed-detail reads use lean projection columns;
- an expanded full-content read follows the event reference to `event_log` by
  tenant, aggregate and event identity;
- replay reads full events from `event_log`, derives the lean shape, and
  applies the selected projection;
- transient spool storage is never used as the long-term read path.

`TenantId` is required in every full-content lookup. User-visible attribute
enumeration excludes the `langwatch.reserved.*` namespace.

### Reserved markers are server-owned

Client-supplied `langwatch.reserved.*` attributes are stripped at the command
boundary, apart from explicitly sanctioned internal propagation fields. The
lean interposition sets event references only after that strip. A projection
or subscriber cannot cause arbitrary object reads by altering the marker.

### Retention has one durable ceiling

Full-content availability follows the `event_log` retention period. Projection
previews may have their own analytical retention, but object-spool lifecycle
does not define customer data retention because the spool is transient.

## Alternatives considered

Permanent per-field object storage introduces another durability and retention
authority and makes every full read depend on it. Keeping full values in fold
state makes Redis cache and ClickHouse writes unbounded. Truncating without a
reference preserves system health but silently discards customer content.

## Consequences

- Projection and queue cost is bounded by preview size rather than trace
  content size.
- Full-content reads and replay have one durable authority.
- Object storage protects transport without becoming part of the projection
  contract.
- The storage lifecycle rule is an operational prerequisite for spool writes.
- Search is complete within the preview budget and intentionally lossy beyond
  it until a full-content search index exists.
