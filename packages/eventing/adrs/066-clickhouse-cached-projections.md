# ADR-066: ClickHouse projections use Redis for read-your-write state

**Status:** Accepted

**Behavioural contracts:**
[fold-read-back-store.feature](../specs/fold-read-back-store.feature),
[redis-fold-cache.feature](../specs/redis-fold-cache.feature),
[fold-read-window.feature](../specs/fold-read-window.feature),
[fold-coalescing.feature](../specs/fold-coalescing.feature), and
[producer-append-coalescing.feature](../specs/producer-append-coalescing.feature)

## Context

ClickHouse is durable and efficient for analytical projection output, but an
immediate read can reach a replica that has not observed the latest write. A
fold that evolves such a read can overwrite current state with a value derived
from stale state. Re-reading the event log for every live delivery is also too
expensive and turns large aggregates into a shared-store bottleneck.

High-fan-in pipelines have a corresponding write problem: one read/write or
append per event creates many tiny operations where one bounded batch is
sufficient.

## Decision

### ClickHouse map projections

A ClickHouse map projection transforms one event into the latest document for
a stable key. It never reads prior projection state. It writes the durable
document and the same document to its required Redis cache before downstream
projection subscribers observe the result.

### ClickHouse fold projections

A ClickHouse fold projection has one logical state store composed of:

- Redis as the read-your-write state for recently committed documents; and
- ClickHouse as the durable state recovered after a genuine cache miss.

The cache is correctness infrastructure, not an optional accelerator. Its TTL
must cover the expected replication-lag window. A cache hit wins. A cache miss
may read ClickHouse. A cache read error is measured separately from a miss,
because it does not prove replication has settled.

The fold persists its complete recoverable working state, including version
and durable applied-event identifiers. A cold cache reads that stored state;
live delivery does not reconstruct the aggregate from the event log. A state
whose stored version cannot satisfy the current fold contract is rebuilt
deliberately through the replay path.

The write order is durable store followed by cache. A rejected cache write is
reported at the write boundary. The event identifiers stored with the durable
row make a redelivered batch idempotent even when the cache entry is absent.

When a fold declares a business-time read window, the executor computes it
from the event and passes it to the repository. A windowed miss is checked once
without the window before absence is accepted or the declared rebuild policy
runs. Repositories do not invent their own windows.

### Bounded coalescing

Backlogged work for one aggregate is folded in queue order with one state load
and one state store. Append-heavy command paths similarly combine a bounded
group into one durable event-log write. Both batch by count and encoded bytes;
one oversized item proceeds alone.

Coalescing preserves each event's stable identity and ordering. A durable
write must acknowledge the whole batch before the queue completes it.

## Consequences

- Redis availability and capacity are part of the ClickHouse projection
  correctness envelope.
- Projection cache failures need explicit metrics and operator alerts.
- Fold repositories return contract-owned state, not query-only summaries or
  raw driver rows.
- Application repositories own the concrete ClickHouse queries and Redis
  clients; Eventing owns their ports and execution order.
- High-fan-in producers declare bounded coalescing instead of relying on
  per-item writes.
