-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- trace_analytics_rollup — ADR-034 additive analytics fast-path.
--
-- An AggregatingMergeTree written to per-span by an APP-SIDE map projection
-- (see traceAnalyticsRollup.mapProjection.ts), NOT by a ClickHouse materialized
-- view. The projection observes the same SpanReceivedEvent the trace-summary
-- fold observes, so a span's rollup contribution is computed in TypeScript
-- next to the same extraction logic (SpanCostService) and inserted as plain
-- numbers via JSONEachRow — no AggregateFunction binary states cross the wire.
--
-- Columns are SimpleAggregateFunction(sum, ...) rather than the full
-- AggregateFunction(sum, ...). Both merge identically for additive sums and
-- counts, but the simple variant lets us insert raw scalars (a Float64, a
-- UInt64) directly: no sumState / countState ceremony, no
-- AggregateFunctionStateConverter, no -State/-Merge combinator dance at read
-- time (plain `sum(CostSum)` works). Read paths therefore stay ordinary
-- aggregations over a regular column.
--
-- Each immutable span contributes one inserted row. The only repeat is a rare
-- crash/retry re-delivery, which over-counts a single bucket by one span's
-- contribution. ADR-034 accepts that explicitly (negligible, non-systematic);
-- replay rebuilds the rollup truncate-first rather than incrementing it.
--
-- Rollup keys are the dimensions final at span-write time only:
-- (TenantId, BucketStart, Model, SpanType). A key is stamped onto the
-- increment when the span is written and can never be re-stamped. Late /
-- trace-level dimensions that flip during the fold (topic, origin, user,
-- conversation) are NOT keys here — they live on the slim trace_analytics
-- table (Phase 2) and serve grouped/percentile/arbitrary-filter reads.
--
-- Retention: TenantId is the project id in this codebase, so every
-- (TenantId, BucketStart) pair already belongs to exactly one project. The
-- per-row `_retention_days` column (same column shape as 00032) carries the
-- project's retention; the TTL clause below drops the row `_retention_days`
-- days after its `BucketStart`. Default 308 (`_retention_days` default — see
-- MIGRATION_DEFAULT_RETENTION_DAYS) matches every other 00032-managed table.
--
-- Deliberately omitted vs the ADR's full sketch:
--   * TraceUniq — replaced by the additive TraceCount below (1 per root span;
--     no uniq state needed because a trace has exactly one root). True
--     distinct-counts over arbitrary dims still live on the slim
--     trace_analytics table (one row per trace, so `count()`/`uniq()` there).
--   * FirstTokenSum — time-to-first-token is resolved at fold time across the
--     trace's spans (stream events / timing fallbacks), not reliable per span.
--   * UserUniq / ConversationUniq — user and conversation are late trace-level
--     dimensions, not final at span-write, so they belong on the slim table.
-- These are served from trace_analytics instead.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_rollup
(
    -- Rollup keys — every dimension final at span-write time.
    TenantId String CODEC(ZSTD(1)),
    -- Minute bucket of the span's StartTime (toStartOfMinute) — also the
    -- partition key leaf, so time-range reads prune partitions.
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Canonical model: response model wins over request model, mirroring
    -- SpanCostService.extractModelsFromSpan. '' when the span carries no model.
    Model LowCardinality(String),
    -- langwatch.span.type ('' when absent).
    SpanType LowCardinality(String),

    -- Raw span count in the bucket. Inserted as `1` per row.
    SpanCount SimpleAggregateFunction(sum, UInt64),
    -- Trace count: 1 per ROOT span, 0 on the rest. Root-ness is final at
    -- span-write (ParentSpanId never changes), so this is a legal rollup
    -- column, and `sum(TraceCount)` = the number of traces in the bucket.
    -- It is the denominator that turns the additive sums into per-trace
    -- averages (avg duration = sum(DurationSum) / sum(TraceCount)) and,
    -- later, error RATE (sum(ErrorCount) / sum(TraceCount)). NOTE it counts
    -- only rooted traces — a trace whose root span never arrives contributes
    -- sums but no TraceCount, so per-trace averages exclude it (documented
    -- divergence vs the slim/legacy per-row avg; see route-table.ts).
    TraceCount SimpleAggregateFunction(sum, UInt64),
    -- Root-span errors only (StatusCode = NormalizedStatusCode.ERROR = 2). 1
    -- per erroring root span, 0 otherwise.
    ErrorCount SimpleAggregateFunction(sum, UInt64),

    -- Per-span cost sums (USD). CostSum is the bucket's total cost;
    -- NonBilledCostSum is the bundled (flat-plan) portion. Billed = the diff.
    CostSum SimpleAggregateFunction(sum, Float64),
    NonBilledCostSum SimpleAggregateFunction(sum, Float64),

    -- Trace wall-clock duration is carried by the root span (DurationMs on the
    -- root, 0 on the rest), so DurationSum across all spans equals the trace's
    -- duration. Averaged at read against the slim table's distinct trace count.
    DurationSum SimpleAggregateFunction(sum, Int64),

    -- Per-span token sums (read from the same canonical SpanAttributes keys the
    -- fold's SpanCostService reads).
    PromptTokensSum SimpleAggregateFunction(sum, UInt64),
    CompletionTokensSum SimpleAggregateFunction(sum, UInt64),
    CacheReadTokensSum SimpleAggregateFunction(sum, UInt64),
    CacheWriteTokensSum SimpleAggregateFunction(sum, UInt64),
    ReasoningTokensSum SimpleAggregateFunction(sum, UInt64),

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    -- 308 = MIGRATION_DEFAULT_RETENTION_DAYS so any row that somehow misses an
    -- explicit value defaults to the same generous floor every other managed
    -- table uses. Sparse encoding compresses the column to ~zero bytes on parts
    -- where every row holds the same value.
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
-- Partition weekly on the same column the ORDER BY (and time-range reads) lead
-- with. Matches every other retention-managed table (`trace_summaries`,
-- `stored_spans`, `evaluation_runs`, … all `toYearWeek(...)`) so the rollup
-- joins the same merge cadence + S3 cold-tier rhythm — partitions age out in
-- the same weekly steps as the source they're derived from, no out-of-band
-- monthly bumps. `BucketStart` is `DateTime64(3)`; wrap to `Date` so the
-- partition expression is anchored on a concrete date type and partition
-- pruning stays sharp on `WHERE BucketStart BETWEEN ...` reads. Retention is
-- also stamped in whole weeks (PLATFORM_DEFAULT_RETENTION_DAYS = 49, multiples
-- of 7 enforced by retentionDaysSchema), so partitions drop cleanly on the
-- TTL boundary.
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, Model, SpanType)
-- Inline retention TTL: drop a row `_retention_days` days after its bucket.
-- TenantId == projectId, so each bucket is per-project and the project's
-- retention applies cleanly. `BucketStart` is DateTime64(3), so the TTL
-- expression wraps it in `toDateTime` (CH rejects DateTime64 directly in TTL
-- arithmetic). ttlReconciler is not responsible for this table — there's no
-- cold-storage MOVE clause (rollup rows are tiny + always warm).
TTL toDateTime(BucketStart) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
