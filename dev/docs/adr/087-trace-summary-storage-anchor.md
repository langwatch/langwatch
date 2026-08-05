# ADR-087: freeze the trace-summary storage anchor, and never let the joined span read go unbounded

**Date:** 2026-08-06

**Status:** Accepted

**Extends:** [ADR-071](./071-coding-agent-session-immutable-storage-anchor.md) - sequencing step 3, applied to the fourth table in its inventory. ADR-071 recorded `trace_summaries` as a same-class instance of the anchor defect and deliberately left it unfixed, tracked as [#6312](https://github.com/langwatch/langwatch/issues/6312). This is that fix. The rule is ADR-071's unchanged: a storage anchor is first-observed, frozen, and separate from any business value derived off it.

**Relates to:** [ADR-066](./066-projection-clickhouse-cached-store.md) (the read-back store that writes this row), [ADR-068](./068-windowed-clickhouse-reads.md) (windowed reads, and the `clickhouse_windowed_read_total` outcomes that measured this), [ADR-034](./034-event-sourced-analytics-materialization.md) (the RMT-plus-IN-tuple materialisation shape).

## Context

### The sentinel, and why it is not a bug in the trace shape

A trace whose only telemetry is log records is a legitimate shape. Claude Code and Codex both emit one (`OTEL_LOGS_EXPORTER` with no traces exporter), and the trace-summary store admits them on purpose: `hasPersistableSignal` returns true on `langwatch.reserved.log_record_count > 0` even when `spanCount` is 0, with a docblock naming those producers outright. Refusing them would lose real customer telemetry.

What is a bug is where those traces get filed. `trace_summaries.OccurredAt` (migration 00002) does two storage jobs:

```sql
PARTITION BY toYearWeek(OccurredAt)
TTL toDateTime(OccurredAt) + toIntervalDay(_retention_days) DELETE   -- ttlReconciler.ts
```

and it was **also** the fold's span timing baseline - the running `min(span.startTimeUnixMs)` that `TotalDurationMs` is measured from, maintained by the shared `SpanTimingService`. Only spans ever set it. So a logs-only trace folds a zero, passes the store's gate on its log-record count, and is committed at `new Date(0)`. `toYearWeek` in its default mode puts 1970-01-01, a Thursday, in the last week of 1969, so that is partition **196952**, with a TTL deadline of `1970 + retention` that is already years past. Production confirms the partition name on both `trace_analytics` and `trace_summaries`.

### Two blast radii, and the second is the expensive one

**The fold path.** `resolveOccurredAtMs` in the trace-summary ClickHouse repository reports such a row as `{ found: true }` with no usable timestamp, so `queryWindowed` runs the unbounded full-partition arm (cold S3 tiers included) on **every delivery**. The exposing metric is `clickhouse_windowed_read_total{table="trace_summaries",outcome="unwindowed"}`, which sat at 55-66% of that table's reads.

**The read path.** In `fetchTracesWithSpansJoined` the `stored_spans` window is derived from the matched summaries' `OccurredAt`, filtered by `typeof t === "number" && t > 0`. When nothing survives, `hasWindow` is false, `queryWindowed` is called with a null hint and `fallback: "none"`, `fallbackFragment` returns `null`, and **both** time filter strings render empty. The query then reads `ResourceAttributes`, `SpanAttributes`, `Events.Attributes` and `Links.*` `FROM stored_spans WHERE TenantId = … AND TraceId IN (…)` with no partition predicate at all. That is the source of the production `MEMORY_LIMIT_EXCEEDED` (code 241) OvercommitTracker kills on trace detail views: uncapped, the victim was picked across the whole cluster, so one bad trace read degraded unrelated queries. #6602 capped that one query at 2 GiB; its own comment says the durable fix is upstream.

A third, smaller consequence sat next to it. `resolveOccurredAtRange` takes `min(OccurredAt)` across the whole batch of trace ids and discards the range unless it is positive, so **one** sentinel row in a page collapsed the window for every other trace on it.

### How this table differs from `trace_analytics`

Migration 00061 fixed exactly this failure mode for `trace_analytics` and only that projection (#6306). Two differences shape the fix here.

Milder: this table's sort key is `(TenantId, TraceId)` and excludes `OccurredAt`, so the ReplacingMergeTree collapses a trace's versions regardless of the anchor moving. ADR-071's consequence 1 - orphaned versions that can never collapse - does not apply, and the sort-key argument that shapes the `trace_analytics` fix is unnecessary. (It collapses *within a partition*, which matters below.)

Sharper: `trace_summaries` rows are read by product paths, not just by analytics. `TraceSummaryData.occurredAt` becomes `trace.timestamps.started_at`, it is the axis the trace list pages on, and it gates the visibility-window teaser redaction in `TraceSummaryService.getByTraceId`. So on this table what the column *means to a reader* has to be handled explicitly, where on `trace_analytics` it did not.

## Decision

**We split the column's two jobs, exactly as 00061 did.** `OccurredAt` becomes the frozen storage anchor - the first business time the fold observes from **any** contribution (span, log record, metric correlation, annotation, topic assignment, origin resolution, rename), never moved after. The span timing baseline moves to a new `EarliestSpanStartMs` column, migration **00072**.

**The rule is shared code, not a second copy.** `MAX_ANCHOR_FUTURE_SKEW_MS`, `isUsableAnchorMs`, `firstUsableAnchor` and `anchorStorageTime` moved out of `traceAnalytics.foldProjection.ts` into `projections/services/storage-anchor.ts`, and both folds call them. Two folds implementing the same storage rule from two copies is how they drift.

**The anchor is frozen at one seam.** `TraceSummaryFoldProjection.apply` overrides the base dispatch, folds the event, then calls `anchorStorageTime`. After the handler, so a span's own start time - which the handler has by then put on `state.occurredAt` - wins over the envelope's ingest stamp; at one seam, so a new event type cannot silently arrive un-anchored the way every non-span contribution did.

**What a logs-only trace is anchored from.** The log event's envelope `occurredAt`, which for a log record is `record.acceptedAt` - platform accept time, which is what ADR-071 argues the anchor should be anyway. Explicitly **not** the log's own `timeUnixMs`, and explicitly not by seeding the timing baseline from it: #6306 tried seeding the baseline from the log and reverted it, because a log accepted after the trace finished inflates `TotalDurationMs` by the whole ingest lag and takes `TokensPerSecond` with it, order-dependently. That is now pinned by a test rather than by memory. The anchor is a storage address; the baseline is a measurement; only spans may set the measurement.

**Old rows are decoded, not refused.** The projection stamp moves to `2026-08-06`, and its predecessor `2026-05-07` is admitted. On a pre-split row `OccurredAt` is `min(span start)`, which is at once a valid anchor (it is what the row is already partitioned and TTL'd on) and the correct timing baseline (it is what `EarliestSpanStartMs` was split out to carry), so the repository reads both fields off that one column and the row heals in place on its next ordinary write.

**The read path can no longer go unbounded.** The `stored_spans` window now falls through three sources: the matched summaries' anchors, then the caller's own paging range (`effectiveOccurredAt` - the trace list and thread views already know their traces' times, and `resolveOccurredAtRange` supplies it for callers that only have ids), then a retention floor via `queryWindowed`'s `{ lookbackMs }` fallback, which renders `now - 90d … now + 2d`. The third can never be null, so the filter string is never empty. `resolveOccurredAtRange` also excludes sentinel rows in SQL so one of them cannot collapse a page's range.

**We are not changing the fold's refold policy.** `refoldOnStoreMiss` stays off and `trustAbsentMiss` stays on. See Backfill.

### Why an anchor rather than back-filling `OccurredAt`

Two reasons, and the first is decisive.

`OccurredAt` cannot be back-filled with the log's time without also becoming the timing baseline, because the fold reads that one field for both jobs. `SpanTimingService` treats `occurredAt > 0` as "a span has seeded the baseline" and measures the trace's duration from it. Back-filling therefore does not fix a storage bug; it converts it into a metrics bug, in a field customers read.

Second, a back-fill of the existing population is a rewrite with a *re-derived* value, which is the precise thing an anchor exists to prevent. A rebuild reaches a different first event than the original fold did (a replay's first event may be a log or a topic assignment predating the first span), so the rewritten anchor differs from the committed one, moves the row's partition, and moves its TTL deadline. A change whose premise is "an anchor is written once" would open by moving every anchor it touched.

### Consequences worth naming

A trace that received an earlier-starting span **late** now anchors on the first span *folded* rather than `min(span start)`, so it can land in a different week partition than it would have before. That is the anchor doing its job - the old value moved backwards on every late span, dragging the TTL deadline towards the row - but it is a real change, not a no-op.

One already-committed row moves, deliberately. The anchor is validated on every write, not only when first frozen, so a row whose committed `OccurredAt` is more than a day ahead of fold time fails `MAX_ANCHOR_FUTURE_SKEW_MS` and is rewritten at fold time. Ingest bounds only the past edge, so such a row is reachable today; it was filed in a future partition with a TTL deadline to match and would have outlived its tenant's retention. It converges after that one write.

The stamp move is forward-only. During a rolling deploy, pods on the previous build refuse the new stamp - their gate is a bare equality - and rewrite at the old stamp rows a new pod wrote. That is the ordinary cost of any stamp bump, bounded by the deploy window rather than by the size of the table.

A logs-only trace stops reporting 1970. `mapTraceSummaryToTrace` now reports the anchor as `started_at` when there is no span baseline, and the list read pages on a real anchor rather than sorting the trace to the bottom of time. The visibility-window gate in `TraceSummaryService` still reads `occurredAt`, so it is unchanged: this ADR does not widen what a gated read shows.

## The version gate

This is the part that goes wrong quietly, so it is stated once and precisely.

A fold read-back that decodes an old row without a version gate turns a missing column into a default and writes that default back as truth. Here the ambiguity is exact: once both shapes exist, `EarliestSpanStartMs = 0` means either *"pre-split row, the baseline lives in `OccurredAt`"* or *"post-split logs-only trace, the baseline genuinely is 0 and `OccurredAt` is an accept time"*. Reading the second as the first hands `SpanTimingService` an accept time as a span start. Reading the first as the second resets a trace's duration baseline to zero and re-measures the whole trace from its next span. Only the stamp separates them.

So `TraceSummaryClickHouseRepository.fromClickHouseRecord` branches on it:

```ts
storageAnchorMs: record.OccurredAt,
occurredAt:
  record.Version === TRACE_SUMMARY_PROJECTION_VERSION_LATEST
    ? Number(record.EarliestSpanStartMs ?? 0)
    : record.OccurredAt,
```

A single equality rather than a set membership, because every stamp older than the latest one - `2026-05-07` and `2026-04-23` alike - gave `OccurredAt` the same meaning.

Three sites decode this row, and all three carry the gate, because a surface that skipped it would report an accept time as a trace's start:

- `TraceSummaryClickHouseRepository.fromClickHouseRecord` - the fold read-back and the single-trace drawer read;
- `traceSummaryTimesFromRow` in `clickhouse-trace.service.ts` - the v1 list and joined-span reads, which build `TraceSummaryData` straight from query rows;
- `TraceListClickHouseRepository.toTraceListItem` - the traces-v2 list.

They page and filter on `OccurredAt` (the anchor) and report `occurredAt` (the baseline), which is the split doing its job: the sort axis is a storage address that never moves, and the reported time is what the trace's spans actually say.

Unlike `trace_analytics`, no stamp is refused. `trace_analytics` refuses pre-00056 stamps because those rows predate its typed read-back columns and every one of them would decode as a default; `trace_summaries` has no such cliff, and the one shape change it does have is unambiguous under the gate above.

## Backfill

**The anchor stops new sentinel rows. It does not repair existing ones.** Stated plainly, because the alternative is that someone assumes it does.

*Existing sentinel rows are already expired.* Their TTL deadline is `1970 + retention`, so the next TTL merge deletes them. This is not a new consequence of this change; it is the state the table has been in.

*A sentinel-anchored trace that receives any further event heals itself.* The read-back decodes `storageAnchorMs = 0`, which fails `isUsableAnchorMs`, so the next contribution freezes a real anchor; and even with no new contribution the write's `firstUsableAnchor([storageAnchorMs, createdAt], now)` chain guarantees a real time. The row is rewritten into a real partition. The sentinel row is **not** collapsed into it - the RMT only collapses within a partition and these two are in different ones - but its TTL is already past, so it is reaped rather than left as a duplicate.

*A sentinel-anchored trace that receives no further event before the reap loses its summary row.* This fold declares no `refoldOnStoreMiss`, so nothing rebuilds it. The trace's spans and log records remain in `stored_spans` and the canonical log store; what is lost is the derived summary - its accumulated cost, tokens and span count.

**No repair ships here, and that is a decision rather than an oversight.** Two options exist and both are bigger than this change:

1. **Turn on `refoldOnStoreMiss`** so a later event rebuilds the aggregate from `event_log`. That is what [#6430](https://github.com/langwatch/langwatch/pull/6430) proposes. It also requires dropping `trustAbsentMiss`, whose docblock records what it bought when it landed: the unwindowed retry it removed was proving non-existence at roughly 100 unpruned scans a minute. Trading that back is a cost decision about read load, independent of the anchor, and it should be priced on its own.
2. **A bounded operational replay** from `event_log`, keyed on the traces whose summary is missing. That is a population-scale job in ADR-069's territory and needs its own sizing and its own failure budget.

Neither is bundled with the anchor, because the anchor is correct and shippable without either, and bundling would make an already load-bearing migration depend on an unrelated read-cost trade. Tracked on [#6312](https://github.com/langwatch/langwatch/issues/6312).

## Consequences

- `clickhouse_windowed_read_total{table="trace_summaries",outcome="unwindowed"}` should fall towards zero as sentinel rows drain; it is the metric that says whether this worked.
- The joined span read can no longer emit an empty time predicate. The 2 GiB `max_memory_usage` cap from #6602 stays as a belt to these braces - a page of very wide traces inside one legitimate window is still a lot of bytes.
- The retention floor is a bound of last resort and can exclude spans filed in `stored_spans`' own epoch partition (a trace whose every span carried an unusable start time). Reading those is precisely the full-partition scan the floor exists to prevent, and no bounded read was ever going to return them.
- `trace_analytics` and `trace_summaries` now share one implementation of the anchor rule. `evaluation_analytics` and `coding_agent_sessions` step 3 remain recorded-only in ADR-071's inventory and are the next adopters of `services/storage-anchor.ts`.

## References

- [ADR-071](./071-coding-agent-session-immutable-storage-anchor.md) - the storage-anchor rule, and the inventory this closes an entry in
- [ADR-066](./066-projection-clickhouse-cached-store.md) - the ClickHouse-cached fold store whose read-back the version gate protects
- [ADR-068](./068-windowed-clickhouse-reads.md) - `queryWindowed`, its fallbacks, and the outcome metric
- `dev/docs/best_practices/clickhouse-queries.md` - IN-tuple dedup, partition-key filtering
- `specs/traces/trace-summary-storage-anchor.feature` - the behavioural contract
- Migration `platform/app/src/server/clickhouse/migrations/00072_trace_summaries_storage_anchor.sql`
- Precedent: [#6306](https://github.com/langwatch/langwatch/pull/6306) (`trace_analytics`, migration 00061). Mitigation already shipped: [#6602](https://github.com/langwatch/langwatch/pull/6602). Overlapping proposal: [#6430](https://github.com/langwatch/langwatch/pull/6430). Issue: [#6312](https://github.com/langwatch/langwatch/issues/6312).
