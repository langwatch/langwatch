-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- evaluation_analytics_rollup — ADR-034 Phase 6 additive analytics fast-path
-- for the EVALUATION pipeline.
--
-- An AggregatingMergeTree written PER-EVALUATION (one row per terminal event)
-- by an APP-SIDE map projection (see evaluationAnalyticsRollup.mapProjection.ts),
-- NOT by a ClickHouse materialized view. The projection observes the same
-- terminal event (`lw.evaluation.completed` / `lw.evaluation.reported`) that
-- the evaluation-run fold consumes, so a row's rollup contribution is computed
-- in TypeScript next to the same canonical extraction logic and inserted as
-- plain numbers via JSONEachRow — no AggregateFunction binary states cross
-- the wire.
--
-- Columns are SimpleAggregateFunction(sum, ...) rather than the full
-- AggregateFunction(sum, ...). Both merge identically for additive sums and
-- counts, but the simple variant lets us insert raw scalars (a Float64, a
-- UInt64) directly: no sumState / countState ceremony, no -State/-Merge
-- combinator dance at read time (plain `sum(EvalCount)` works).
--
-- Each immutable terminal event contributes one inserted row. The only repeat
-- is a rare crash/retry re-delivery, which over-counts a single bucket by one
-- evaluation's contribution. ADR-034 accepts that explicitly (negligible,
-- non-systematic); replay rebuilds the rollup truncate-first rather than
-- incrementing it.
--
-- Rollup keys are the dimensions final at evaluation-completion time only:
-- (TenantId, BucketStart, EvaluatorType, Status). EvaluatorType is the
-- evaluator slug (e.g. `langevals/llm_answer_match`); Status is the canonical
-- terminal eval status enum (`processed` / `error` / `skipped`). Late /
-- run-level dimensions that flip during the fold (trace_id, user_id,
-- customer_id, conversation_id, label) are NOT keys here — they live on the
-- slim `evaluation_analytics` table (Phase 6 slim) and serve grouped /
-- percentile / arbitrary-filter reads.
--
-- Retention: TenantId is the project id in this codebase, so every
-- (TenantId, BucketStart) pair already belongs to exactly one project. The
-- per-row `_retention_days` column (same column shape as 00032) carries the
-- project's retention; the TTL clause below drops the row `_retention_days`
-- days after its `BucketStart`. Default 308 (`MIGRATION_DEFAULT_RETENTION_DAYS`)
-- matches every other 00032-managed table.
--
-- Deliberately omitted vs the trace-rollup (00035) sketch:
--   * EvalUniq — moved to the slim evaluation_analytics table. Slim is one row
--     per evaluation, so a distinct-evaluation count is just `count()` there.
--   * Per-eval token sums — evaluations carry their own COST (via CostId FK)
--     and DURATION (started_at → completed_at), but not direct token counts;
--     the per-evaluator tokens, when meaningful, live on the trace's
--     `trace_analytics_rollup` row instead. We carry CostSum + NonBilledCostSum
--     here for the eval-cost analytics direction, and Duration for the
--     eval-runtime distribution direction.
--   * Late dims (traceId, userId, conversationId, customerId, label) — these
--     flip during the fold for the same reasons trace-side late dims do; they
--     belong on the slim table.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup
(
    -- Rollup keys — every dimension final at evaluation-completion time.
    TenantId String CODEC(ZSTD(1)),
    -- Minute bucket of the evaluation's completedAt (toStartOfMinute) — also
    -- the partition key leaf, so time-range reads prune partitions.
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Evaluator slug (e.g. `langevals/llm_answer_match`). '' when somehow absent.
    EvaluatorType LowCardinality(String),
    -- Terminal evaluation status: `processed` | `error` | `skipped`. The fold's
    -- non-terminal `scheduled` / `in_progress` statuses never make it onto a
    -- rollup row because the map projection only subscribes to the terminal
    -- events.
    Status LowCardinality(String),

    -- Raw evaluation count in the bucket. Inserted as `1` per row.
    EvalCount SimpleAggregateFunction(sum, UInt64),
    -- Pass/fail outcome counts derived from `passed: boolean | null` on the
    -- terminal event. Both 0 when `passed` is null (e.g. score-only evaluators
    -- with no boolean verdict). Sum to a clean pass-rate via:
    --   sum(PassCount) / nullIf(sum(PassCount) + sum(FailCount), 0)
    PassCount SimpleAggregateFunction(sum, UInt64),
    FailCount SimpleAggregateFunction(sum, UInt64),
    -- Terminal-status counters: ErrorCount = `status = 'error'` rows;
    -- SkippedCount = `status = 'skipped'` rows. Sum to a clean error-rate.
    ErrorCount SimpleAggregateFunction(sum, UInt64),
    SkippedCount SimpleAggregateFunction(sum, UInt64),

    -- Score: stored as both the sum AND a per-bucket count of present scores
    -- so the read path can produce a TRUE average (sum/count) rather than a
    -- bucket-average of bucket-averages. ScoreCount counts only rows where the
    -- evaluator emitted a numeric score (null → 0). Avg score then:
    --   sum(ScoreSum) / nullIf(sum(ScoreCount), 0)
    ScoreSum SimpleAggregateFunction(sum, Float64),
    ScoreCount SimpleAggregateFunction(sum, UInt64),

    -- Evaluation wall-clock duration (completedAt - startedAt). 0 when either
    -- timestamp is missing (custom SDK report events that arrive atomically
    -- set both to the same instant, so duration = 0).
    DurationSum SimpleAggregateFunction(sum, Int64),

    -- Evaluation cost sums (USD) via the CostId path. CostSum is the bucket's
    -- total evaluator cost; NonBilledCostSum is the bundled (flat-plan) portion.
    -- Both 0 when the evaluator did not record a cost (the common case for
    -- non-LLM evaluators).
    CostSum SimpleAggregateFunction(sum, Float64),
    NonBilledCostSum SimpleAggregateFunction(sum, Float64),

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    -- 308 = MIGRATION_DEFAULT_RETENTION_DAYS so any row that somehow misses an
    -- explicit value defaults to the same generous floor every other managed
    -- table uses. Sparse encoding compresses the column to ~zero bytes on parts
    -- where every row holds the same value.
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
-- Partition weekly on the same column the ORDER BY (and time-range reads) lead
-- with. Matches trace_analytics_rollup (00035) — `BucketStart` is
-- `DateTime64(3)`; wrap to `Date` so the partition expression is anchored on a
-- concrete date type and partition pruning stays sharp on
-- `WHERE BucketStart BETWEEN ...` reads. Retention is also stamped in whole
-- weeks (PLATFORM_DEFAULT_RETENTION_DAYS = 49, multiples of 7 enforced by
-- retentionDaysSchema), so partitions drop cleanly on the TTL boundary.
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, EvaluatorType, Status)
-- Inline retention TTL: drop a row `_retention_days` days after its bucket.
-- TenantId == projectId, so each bucket is per-project and the project's
-- retention applies cleanly. `BucketStart` is DateTime64(3), so the TTL
-- expression wraps it in `toDateTime` (CH rejects DateTime64 directly in TTL
-- arithmetic). Mirrors trace_analytics_rollup (00035) exactly.
TTL toDateTime(BucketStart) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
