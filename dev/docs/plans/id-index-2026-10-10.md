# Trace index: one exact read for a lookup by trace id (parked, 2026-10-10)

Status: parked design, agreed with Alex in the upgrade trials. Pick up as its own piece of work.

## The problem

`trace_summaries` is `ORDER BY (TenantId, TraceId)` but `PARTITION BY toYearWeek(OccurredAt)`. A lookup
with a time range prunes to its weeks and is cheap. A lookup **by trace id alone** (open a trace, a link
from an evaluation or alert, a span arriving, the SDK fetching a trace) has no time, so it must consult
every weekly partition's index, cold S3 parts included. Today the anchored lookup ladder (3, 7, 21, 30
days back from the event's own time, ARCHITECTURE.md "A trace summary lookup is anchored") bounds this,
and the cold-scan warning flags anything unbounded.

Every other search (filters, analytics, the table view) is always time-bounded, or goes through
`trace_analytics` or LWQL, so it does not need this.

## The design

```
trace_summaries ──(materialised view on insert)──► trace_index
                                                   TenantId, TraceId → OccurredAt (trace start)
                                                   ReplacingMergeTree
                                                   ORDER BY (TenantId, TraceId)
                                                   NO partitioning
                                                   TTL by the tenant's retention
```

- **No partition at all.** Not by time (that is the problem) and not by tenant (thousands of tenants
  means thousands of tiny partitions). One table; merges keep it to a handful of parts.
- **Key:** `ORDER BY (TenantId, TraceId)` is already unique as a pair, so no concatenated `tenant:trace`
  column is needed.
- **Three small columns.** The sparse primary index (one entry per 8,192 rows) stays in memory, so a
  lookup is a binary search in RAM plus one granule read. Not O(1), but close enough.
- **Written once.** A trace's start never changes; summary updates re-insert the same start and the
  ReplacingMergeTree collapses them. No app code writes it.
- **Retention.** A TTL on the row, using the same retention days the summary row carries, so it expires
  with the data and needs no clean-up job.
- **A new trace** is not in the index until its first summary insert lands, which correctly reads as
  "new trace".

Lookup, in one statement:

```sql
SELECT … FROM trace_summaries
WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
  AND OccurredAt IN (SELECT OccurredAt FROM trace_index
                     WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String})
```

## To prove before building

1. ClickHouse prunes partitions from `OccurredAt IN (subquery)` on the partition key. If not, it is two
   small queries: index first, then the summary with an exact time bound.
2. The materialised view's cost on `trace_summaries` inserts is negligible at cloud volume.
3. Backfill: one background `.withMigrations` step fills the index from existing summaries; until it is
   done, the anchored ladder stays the fallback. Once filled, the ladder can go.

## Same idea elsewhere

Thread or conversation id lookups have the same shape (no time, an id) and could use the same index,
keyed by thread instead.
