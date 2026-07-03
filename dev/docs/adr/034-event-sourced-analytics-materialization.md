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

A **fold projection** writes the latest state per aggregate into a slim, time-sorted `ReplacingMergeTree(Version)`. **Idempotent and replay-safe by construction** (re-fold → same canonical state → dedup by version) — the platform's required contract, and identical to how `trace_summaries` already behaves. Holds **every dimension** (including the late/derived ones — topic, origin, user, conversation, model, …) and every metric scalar. Serves **percentiles, min/max, any dim-grouped query, arbitrary filters** — ~10–50× cheaper to scan than `trace_summaries` (slim rows, time-leading sort).

### 2. Rollup — `<x>_analytics_rollup` (the additive fast-path)

An `AggregatingMergeTree` fed by **per-span increments** — `sumState`/`uniqState`. Each span contributes its own metric value; trace count = `uniqState(TraceId)` (every span shares the trace id, so it collapses to one); trace duration = the root span's value, 0 on the rest. **No signs, no collapsing, no settle.**

**Why per-span (not per-trace).** A per-trace source *mutates* — a trace becomes N versions as spans land, an MV over it fires N times → every trace N×-wrong (systematic). A **span is a single immutable event**, processed once; the only repeat is a rare crash/retry re-delivery → a fraction-of-a-percent of buckets, transient, non-systematic. **We accept that** (explicitly — it's negligible). Replay re-fires everything, so **replay = truncate the rollup and rebuild**, a deliberate op, not steady-state.

**Rollup keys = dims final at span-write only: `(TenantId, BucketStart[=span time], Model, SpanType)`.** A rollup key is stamped onto the increment when the span is written and can never be re-stamped. Topic is a *classified id* computed after the spans. Origin is resolved *inside the fold* and **flips** as spans arrive (a provisional `application` is overridden when the root span's real marker lands — see `trace-origin.service.ts:147-163`). Neither is final at span-write, so **neither can be a rollup key** — they live on the slim table. (Adding a late `0`-metric row for the resolved value does not move the already-summed cost off the provisional label; re-attributing it would require the signed correction we rejected.)

### Read routing (`getTimeseries`)

- additive (sum/count/avg/distinct) **and** group-by ∈ {none, `Model`, `SpanType`} **and** no exotic filter → **rollup**
- percentiles, min/max, any other group-by (topic/origin/user/…), arbitrary filters → **slim table**
- else → `trace_summaries` (the drawer's table, untouched)
- default to slim/raw on any doubt.

### Shared fleet

Generic fold + per-span-increment + read-routing machinery, parameterised per pipeline by field extractors. Traces first; evaluations, scenarios, experiments each plug in with their own `<x>_analytics` + `<x>_analytics_rollup`. Our own copy — **not** the governance substrate (ADR-018 maps to a *flat* table; we map-with-aggregate, deliberately divergent).

## Trace fields

**`trace_analytics`** — `ReplacingMergeTree(Version)`, `ORDER BY (TenantId, OccurredAt, TraceId)`:
```
keys:   TenantId, TraceId, OccurredAt, Version
dims:   TraceName, TopicId, SubTopicId, UserId, ConversationId, CustomerId, Origin, Models[], Labels[]
values: TotalCost, NonBilledCost, TotalDurationMs, TimeToFirstTokenMs,
        PromptTokens, CompletionTokens, CacheReadTokens, CacheWriteTokens, ReasoningTokens,
        TokensPerSecond, HasError, HasAnnotation
```

**`trace_analytics_rollup`** — `AggregatingMergeTree`, `ORDER BY (TenantId, BucketStart, Model, SpanType)`, fed per-span:
```
counts:  TraceUniq = uniqState(TraceId), SpanCount, ErrorCount (root span)
sums:    CostSum, NonBilledCostSum, DurationSum (root span), FirstTokenSum (root span),
         PromptTokensSum, CompletionTokensSum, CacheReadTokensSum, CacheWriteTokensSum, ReasoningTokensSum
distinct: UserUniq, ConversationUniq   (uniqState)
```
Averages derived at read (`CostSum / TraceUniq`, …).

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
