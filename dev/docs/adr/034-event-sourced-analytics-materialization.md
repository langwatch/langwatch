# ADR-034: Event-Sourced Analytics Materialization

- **Status:** Accepted
- **Date:** 2026-06-20
- **Supersedes:** the abandoned Postgres app-rollup (sign-collapsing + HLL/t-digest sketches — wrong layer).
- **Behavioural contract:** [specs/analytics/event-sourced-analytics-materialization.feature](../../specs/analytics/event-sourced-analytics-materialization.feature)

## Context

Custom graphs and threshold triggers read analytics by aggregating over time. Today that re-scans + re-dedups `trace_summaries` on every render — wide rows, `ORDER BY (TenantId, TraceId)` (wrong for time scans), un-deduped `stored_spans` joins pulling heavy `SpanAttributes`, `quantileExact` over raw rows. "Huge queries all the time," and threshold triggers poll that path on a 3-minute K8s cron.

We want analytics + triggers cheap and real-time, using ClickHouse's native engines, with the **idempotency the platform actually requires** (delivery is at-least-once; replay re-applies events — ADR-021/022/015). This is the materialization for **traces, evaluations, scenarios, experiments** — a shared primitive, traces first.

## Decision

Two ClickHouse projections off the event log, per aggregate.

### 1. Slim table — `<x>_analytics` (the per-aggregate truth)

A **fold projection** writes the latest state per aggregate into a slim, time-sorted `ReplacingMergeTree(UpdatedAt)` (the sketch said `Version`; ClickHouse rejects `LowCardinality(String)` as a version column, and `UpdatedAt` matches `trace_summaries`'s convention — `Version` stays as a schema-snapshot tag). **Idempotent and replay-safe by construction** (re-fold → same canonical state → readers dedup by latest UpdatedAt per aggregate id) — the platform's required contract, and identical to how `trace_summaries` already behaves. Holds **every dimension** (including the late/derived ones — topic, origin, user, conversation, model, …) and every metric scalar. Serves **percentiles, min/max, any dim-grouped query, slim-supported filters** (unsupported filters fall back to `trace_summaries` — see Read routing) — ~10–50× cheaper to scan than `trace_summaries` (slim rows, time-leading sort).

**Fold-state continuity.** The slim row is deliberately lossy (trimmed attributes, booleans), so the fold cannot read its state back from its own table the way the trace-summary fold does. Continuity comes from two layers instead: a Redis cache in front of the store (warm path) and the framework's `refoldOnStoreMiss` fold option — on a cache miss the executor rebuilds state **from the event log** up to the delivered event (log-order bounded, so a persisted-but-still-queued event is never pre-applied). This keeps the slim fold an independent projection with its own queue/retry lifecycle — one event fans out to two projections at the dispatch layer, each owning its own store — while the event log remains the source of truth for state reconstruction.

### 2. Rollup — `<x>_analytics_rollup` (the additive fast-path)

An `AggregatingMergeTree` fed by **per-span increments** — `SimpleAggregateFunction(sum, …)` (the sketch said `sumState`/`uniqState`; the simple variant lets the app insert plain numbers and read plain `sum(…)`, no binary state on the wire). Each span contributes its own metric value; trace count = `TraceCount` summed as **1 per root span** (root-ness is final at span-write and a trace has exactly one root, so no uniq state is needed); trace duration = the root span's value, 0 on the rest. True distinct-counts over arbitrary dims (users, conversations) have no simple-sum form and live on the slim table instead. **No signs, no collapsing, no settle.**

**Why per-span (not per-trace).** A per-trace source *mutates* — a trace becomes N versions as spans land, an MV over it fires N times → every trace N×-wrong (systematic). A **span is a single immutable event**, processed once; the only repeat is a rare crash/retry re-delivery → a fraction-of-a-percent of buckets, transient, non-systematic. **We accept that** (explicitly — it's negligible). Replay re-fires everything, so **replay = truncate the rollup and rebuild**, a deliberate op, not steady-state.

**Rollup keys = dims final at span-write only: `(TenantId, BucketStart[=span time], Model, SpanType)`.** A rollup key is stamped onto the increment when the span is written and can never be re-stamped. Topic is a *classified id* computed after the spans. Origin is resolved *inside the fold* and **flips** as spans arrive (a provisional `application` is overridden when the root span's real marker lands — see `trace-origin.service.ts:147-163`). Neither is final at span-write, so **neither can be a rollup key** — they live on the slim table. (Adding a late `0`-metric row for the resolved value does not move the already-summed cost off the provisional label; re-attributing it would require the signed correction we rejected.)

### Read routing (`getTimeseries`)

- additive `sum` **and ungrouped** **and** no filter → **rollup**
- `avg` → **rollup only ungrouped and only for metrics whose legacy column is non-nullable** (today: completion_time), computed as `sum(MetricSum) / sum(TraceCount)`; nullable-metric avgs (cost, tokens) stay on slim, whose one-row-per-aggregate shape reproduces CH `avg`'s NULL-skipping denominator
- percentiles, min/max, **every** group-by (model/topic/origin/user/…), slim-supported filters, distinct-counts → **slim table**; unsupported metrics/filters (events, blocklisted attribute keys, …) fall back to the legacy tables
- else → `trace_summaries` (the drawer's table, untouched) or `evaluation_runs` for eval-source metrics
- default to slim/raw on any doubt.

> **Shipped divergence:** the routing union is 6-way, not 3-way — both trace and eval sources ship with rollup + slim + legacy fallback. Cross-source series mix falls back to `trace_summaries`. Live in `pickAnalyticsTable` (see `routing/route-table.ts`); details in Implementation status.

**The rollup serves ungrouped reads only** (revised 2026-07-09). `Model` and `SpanType` are *sort* keys — they keep the merged row count low — not read contracts. Grouping on them is not parity-safe for two independent reasons:

1. **Attribution flips from per-trace to per-span.** Legacy attributes a trace's *whole* metric to every model the trace used — `arrayJoin(if(empty(Models), ['unknown'], Models))` over trace-level `TotalCost` — a choice `aggregation-builder.ts` documents as deliberate anti-double-counting. The rollup instead splits the metric across each span's own model. Both are defensible readings; they are different numbers, and they don't even agree on the total (legacy over-counts multi-model traces, the rollup totals exactly).
2. **Root-only columns collapse into one bucket.** `DurationSum`, `TraceCount` and `ErrorCount` are recorded on the *root* span only. Root spans are usually workflow/agent spans carrying no model, so `sum(completion_time)` grouped by model puts ~100% of duration in the `'unknown'` bucket and reports `0` for every real model — and whether that happens depends on whether the customer wraps their LLM call in a parent span. Same query, different answer per SDK usage.

`metadata.model` therefore routes to the **slim** table, which is one row per trace with a `Models Array(String)` and trace-level metric columns — structurally what `trace_summaries` has, so `arrayJoin(Models)` reproduces legacy character-for-character (including the `'unknown'` bucket and legacy's `handlesUnknown` suppression of `HAVING group_key != ''`). `metadata.span_type` has no slim column at all (span type is per-span, slim is per-trace) and falls back to `trace_summaries`.

**Routing invariant:** each rollup's group-by set must remain a subset of its slim table's — trace and eval alike. Slim is strictly more capable; if a rollup can group by a key its slim cannot, the router has no safer table to fall to. Pinned by tests in `route-table.unit.test.ts`.

(The eval rollup keeps its group-bys: `EvaluatorType` and `Status` are final at evaluation-completion time and sit on the rollup's keying tuple, so they carry none of the per-span attribution hazard above.)

### Shared fleet

Generic fold + per-span-increment + read-routing machinery, parameterised per pipeline by field extractors. Traces first; evaluations, scenarios, experiments each plug in with their own `<x>_analytics` + `<x>_analytics_rollup`. Our own copy — **not** the governance substrate (ADR-018 maps to a *flat* table; we map-with-aggregate, deliberately divergent).

> **Scope note (2026-07-07):** traces + evaluations ship; the
> scenario / experiment / suite write-side (the original Phase 7) was
> **pulled back** during stack review. Nothing reads those tables yet, and
> two of the three schemas already contained their own re-migration seed
> (the suite rollup keyed on BatchRunId because SuiteId is unavailable on
> the item event; the slim tables anchored on a per-event moving
> timestamp). Since replay rebuilds these tables from the event log
> whenever a real consumer lands, accumulating data early buys nothing —
> re-add each aggregate when a consumer names its columns.

## Trace fields

**`trace_analytics`** — `ReplacingMergeTree(UpdatedAt)`, `ORDER BY (TenantId, OccurredAt, TraceId)`:
```
keys:   TenantId, TraceId, OccurredAt, UpdatedAt (dedup), Version (schema tag)
dims:   TraceName, TopicId, SubTopicId, UserId, ConversationId, CustomerId, Origin, Models[], Labels[]
values: TotalCost, NonBilledCost, TotalDurationMs, TimeToFirstTokenMs,
        PromptTokens, CompletionTokens, CacheReadTokens, CacheWriteTokens, ReasoningTokens,
        TokensPerSecond, HasError, HasAnnotation
```

**`trace_analytics_rollup`** — `AggregatingMergeTree`, `ORDER BY (TenantId, BucketStart, Model, SpanType)`, fed per-span via an app-side map projection; every column `SimpleAggregateFunction(sum, …)`:
```
counts:  SpanCount, TraceCount (1 per root span), ErrorCount (root span)
sums:    CostSum, NonBilledCostSum, DurationSum (root span),
         PromptTokensSum, CompletionTokensSum, CacheReadTokensSum, CacheWriteTokensSum, ReasoningTokensSum
```
`TraceUniq`/`UserUniq`/`ConversationUniq` (uniq state) and `FirstTokenSum` (fold-time, not per-span) were dropped — distinct-counts and TTFT route to the slim table. Per-trace averages derive at read as `sum(MetricSum) / sum(TraceCount)` for the non-nullable metrics (see Read routing); `TraceCount` is also the future error-RATE denominator.

## Consequences

- Native ClickHouse aggregation; no app-level summing of mutable state, no signs.
- **Accepted:** a rare crash/retry re-delivery double-counts one span's increment — negligible, non-systematic. **Replay rebuilds the rollup** (truncate-first); the slim fold needs no special replay handling.
- **Percentiles + every late/rich-dim grouping read the slim table**, not the rollup. The rollup is the additive, bounded-dim fast-path (the most common dashboards: totals/averages/error-rate over time ± model/span_type).
- Storage: slim table ~+5–10% of `trace_summaries`; rollup < 1%.
- Adding eval/scenario/experiment = field extractors + two migrations on shared machinery.

## Migration

1. CH migrations create `trace_analytics` + `trace_analytics_rollup`.
2. Both projections dual-tap **silently** (no read change). Reconstruct via **replay** (ADR-015) — slim fold re-applies idempotently; rollup is truncated and rebuilt.
3. Repoint `getTimeseries` behind a Project flag; reconcile vs the live path (~1 week).
4. Flip the flag; triggers move off the cron; keep the comparator as a tripwire.

## Keep / drop (from the prior attempt)

**Keep, repointed:** the recurring-tick scheduler (ADR-038 — promoted to a generic outbox heartbeat primitive), `evaluateCustomGraphThreshold`, the trigger / notification / custom-graph services, the active-trigger read model.
**Drop:** the Postgres `CustomGraphTriggerRollupBucket` + migrations, the sketches, the sign-collapsing, the `graphRollupTrigger` reactors, the relevance gate, `graphSeriesValue`/`evaluationSeriesValue` (already removed by the reset to `6e496787e`).

## Related

ADR-002/007 (event sourcing), **ADR-021 (lean fold cache — folds idempotent under replay)**, **ADR-022 (event log source of truth — at-least-once re-apply)**, **ADR-015 (projection replay — folds only; coordinated dedup)**, ADR-024 (cold-path tiered storage), **ADR-038 (outbox heartbeat primitive — the absence-detection consumer Phase 5 motivated)**. ADR-018 (governance flat substrate) — considered, deliberately **not** shared.
