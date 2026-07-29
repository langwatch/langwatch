# ADR-083: `stored_spans` elects the wrong version — fix the readers now, re-key the table later

**Date:** 2026-07-29

**Status:** Accepted

**Corrects:** migration `00002_create_schema.sql:116-118`, which declares `stored_spans` as `ReplacingMergeTree(StartTime)`, and `dev/docs/best_practices/clickhouse-queries.md`, which told readers of that table to dedup with `max(StartTime)`.

**Relates to:** [ADR-071](./071-coding-agent-session-immutable-storage-anchor.md) (the same class of finding — a storage anchor doing a job it cannot do — on `coding_agent_sessions`), [ADR-034](./034-event-sourced-analytics-materialization.md) (the RMT-plus-IN-tuple materialisation shape).

## Context

`stored_spans` is the largest table in the system and holds every span.

```sql
ENGINE = ReplacingMergeTree(StartTime)      -- 00002:116
PARTITION BY toYearWeek(StartTime)          -- 00002:117
ORDER BY (TenantId, TraceId, SpanId)        -- 00002:118
```

The version column is `StartTime`. `StartTime` is the span's **own business start time**, carried verbatim from the emitter. The writer stamps a separate `UpdatedAt = new Date()` on every insert (`span-storage.clickhouse.repository.ts`, `toClickHouseRecord`).

So the table has two candidate versions, and the codebase disagrees about which one is the version:

| Site | Elects | Live? |
|---|---|---|
| the engine's background merge | `max(StartTime)` | yes |
| `dedupInTuple` (app-layer span-storage repository, 12 call sites) | `max(UpdatedAt)` | yes |
| `argMax(…, UpdatedAt)` aggregates, `sinceUpdatedAtMs` incremental reader | `UpdatedAt` | yes |
| the trace-detail read (`ClickHouseTraceService.getTracesWithSpans` → private `fetchTracesWithSpansJoined`) | `max(StartTime)` | yes — **this ADR changes it** |
| `src/server/traces/repositories/span-storage.clickhouse.repository.ts` | `max(StartTime)` | no — dead, **deleted here** |

## Decision

**`UpdatedAt` is the correct version column. `StartTime` is not a version at all.**

Three reasons, in order of how much they matter:

1. **`StartTime` cannot order versions, because it does not change between them.** A re-reported span carries the same start time. Every version of that span therefore *ties* on `StartTime`. A version column that ties on the ordinary case is not selecting a version; ClickHouse falls back to "the last row in the merge selection", which is part order — an implementation detail, not a contract.

2. **When `StartTime` does differ, it points the wrong way.** Measured against ClickHouse 25.10: insert a span, re-report it with a corrected *earlier* start time, then `OPTIMIZE … FINAL`. The read returns the corrected span before the merge and the **original** after it, because the merge keeps `max(StartTime)`. The corrected row is not shadowed — it is *deleted*. This is silent, permanent loss of the newer write, not a transient read/merge divergence.

3. **`UpdatedAt` is what every other reader already means.** The incremental `sinceUpdatedAtMs` reader is only coherent under an `UpdatedAt` version; so are the `argMax(…, UpdatedAt)` aggregates.

### What ships now

**The live reader that elected `max(StartTime)` is corrected to `max(UpdatedAt)`.** `fetchTracesWithSpansJoined` — the private join behind `ClickHouseTraceService.getTracesWithSpans` — is on the trace-detail read path, and the bug it carried was worse than a stale row: because every version of a re-reported span ties on `StartTime`, *every tied row satisfied the IN-tuple*, and there is no `LIMIT 1 BY SpanId` behind it. The read returned the span **once per unmerged version**, so a re-reported span rendered repeatedly in one trace, with stale content in all but one copy. Measured: two unmerged versions in, two rows out. Under `max(UpdatedAt)`, one row out.

**The dead third copy is deleted.** `src/server/traces/repositories/span-storage.clickhouse.repository.ts` carried its own `max(StartTime)` dedup and had no production caller; its two remaining test importers (`clickhouse-trace-dedup.integration.test.ts`, `clickhouse-trace-rag-contexts.integration.test.ts`) now use the app-layer span-storage repository.

The guidance in `clickhouse-queries.md` that recommended `max(StartTime)` for this table is removed — it is what the two `max(StartTime)` sites were following.

### What does not ship

**The engine argument is not changed.** ClickHouse has no `ALTER` for it:

```text
ALTER TABLE … MODIFY ENGINE = ReplacingMergeTree(UpdatedAt)
  -> Code 62, SYNTAX_ERROR. Expected one of: STATISTICS, COLUMN, ORDER BY,
     SAMPLE BY, TTL, SETTING, QUERY, SQL SECURITY, DEFINER, REFRESH, COMMENT.
ALTER TABLE … MODIFY SETTING version_column = 'UpdatedAt'
  -> Code 115, UNKNOWN_SETTING.
```

The only route is a full table rebuild — `CREATE TABLE stored_spans_v2 … ReplacingMergeTree(UpdatedAt)`, backfill by `INSERT … SELECT`, catch the tail written during the backfill, `EXCHANGE TABLES`. On the largest table in the system that means double storage for the duration, hours of sustained merge and I/O load on a cluster that ingest is concurrently writing to, and a cutover window where writes have to be dual-written or replayed. That is an operator procedure planned against a maintenance window, not something an auto-running goose migration may do on deploy. Shipping it as one would be the more dangerous change.

### Why the readers are safe to leave ahead of the rebuild

Until the rebuild, the reader and the merge still disagree — the reader elects the latest write, the merge elects the latest start time. The disagreement is only *reachable* when a span is re-reported with a **different** `StartTime`, and that case is already outside what the read path supports for an unrelated reason: `PARTITION BY toYearWeek(StartTime)` puts a span whose start time crosses a week boundary into a different partition, where `ReplacingMergeTree` never dedups at all (measured: `OPTIMIZE … FINAL` leaves both rows). Every read of this table, including the pre-existing ones, already assumes `StartTime` is stable per `(TenantId, TraceId, SpanId)` — `partitionFragment` bounds the dedup subquery on `StartTime`, which is only sound under that assumption.

So the pre-rebuild position is: `StartTime` immutability is a **load-bearing assumption the table already depends on**, and under it the reader's election is right and the merge's is right-by-accident. The rebuild is what turns "right by accident" into "right".

## Consequences

- The trace-detail read stops duplicating re-reported spans. This is user-visible.
- The two live readers of `stored_spans` now agree with each other. They did not: the same span could appear differently depending on which service answered.
- The engine still elects on `StartTime`. Until the rebuild, a span re-reported with a *changed* start time can be lost at merge time. Nothing in the ingest path is known to change it, and the read path already could not have coped if it did.
- `specs/clickhouse/span-version-election.feature` carries both halves — the election that ships, and the merge election, tagged `@deferred`.

## Follow-up

1. Rebuild `stored_spans` onto `ReplacingMergeTree(UpdatedAt)` via the CREATE/backfill/EXCHANGE procedure above, in a planned window.
2. Consider re-anchoring `PARTITION BY` at the same time. `toYearWeek(StartTime)` has the same movable-anchor problem ADR-071 priced for `coding_agent_sessions.StartedAt`: a corrected start time relocates the row to a partition where it can never merge with its predecessor. A rebuild is the only chance to change it, so the two decisions should be taken together rather than paying for two rebuilds.
