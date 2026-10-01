# ADR-029: Large queue bodies use a leased content-addressed payload store

**Status:** Accepted

**Related:**
[Stored Objects ADR-001](../../features/stored-objects/adrs/001-package-boundary.md)
owns a separate durable-reference feature. GroupQueue owns this leased payload
store and its injected object-store capability.

**Behavioural contracts:**
[payload-store-content-addressed.feature](../specs/payload-store-content-addressed.feature)
and
[payload-store-blob-hardening.feature](../specs/payload-store-blob-hardening.feature)

## Context

Large bodies should not be copied into every Redis job. Identical fan-out work
should share storage, and completing one job must not reclaim bytes still
needed by another. Partial failures must not create unbounded memory use,
delete recoverable content or trust a tampered stored location.

## Decision

The body digest is computed from the canonical uncompressed bytes and is the
content identity. Storage selects one of three locations by bounded size and
configuration:

- inline in the envelope;
- Redis for short-lived offload; or
- a durable object store for larger bodies.

The persisted reference records identity and integrity, not an authority to
read an arbitrary location. Resolution derives the permitted location from
the digest and configured store, verifies size and digest, then decodes within
the envelope limits.

Durable keys use the caller-owned `group-queue` namespace beneath the project
root, such as `{projectId}/group-queue/{contentHash}`. GroupQueue's object-store
adapter encodes that structured key. Its sweeper cannot enumerate the
`stored-objects` namespace, while a platform project purge can still enumerate
the complete project root.

Each staged job holds a lease on referenced content. Identical bodies may
share the content while retaining distinct holder leases. Deduplication,
completion, retry and poison handling release or transfer only the relevant
holder. Release is idempotent and never performs eager deletion.

Redis-side lease transitions are atomic Lua operations. Every key involved in
a transition shares the queue's Redis Cluster hash slot. A transfer takes the
new lease and releases the prior lease in one operation.

Content has a TTL backstop. When the last Redis holder releases, the remaining
content receives a bounded grace window. A sweeper reclaims expired leases and
unreferenced Redis content in cursor-bounded passes. Durable objects are
reclaimed by GroupQueue's durable-tier lifecycle and sweeper contract.

Errors distinguish absent content, integrity failure, transient store failure
and payload-limit rejection. A body that remains readable is retained while a
decode or handler failure is reported. No path allocates an unbounded buffer
from envelope metadata.

## Consequences

- Fan-out shares bytes without sharing job identity or lifecycle state.
- Content reclamation is eventually consistent and safe under concurrent
  restaging.
- Queue completion does not depend on eager object deletion.
- Store implementations must provide bounded reads, integrity checks, leases
  and observable reclamation.
