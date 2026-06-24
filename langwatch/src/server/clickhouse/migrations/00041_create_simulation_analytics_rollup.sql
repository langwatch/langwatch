-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- simulation_analytics_rollup — ADR-034 Phase 7 additive analytics fast-path
-- for the SIMULATION pipeline (scenarios).
--
-- An AggregatingMergeTree written PER-SIMULATION-RUN (one row per terminal
-- event) by an APP-SIDE map projection
-- (see simulationAnalyticsRollup.mapProjection.ts), NOT by a ClickHouse
-- materialized view. The projection observes the same per-aggregate-terminal
-- event (`lw.simulation_run.finished`) that the simulation-run fold consumes
-- on completion, so a row's rollup contribution is computed in TypeScript next
-- to the same canonical extraction logic and inserted as plain numbers via
-- JSONEachRow — no AggregateFunction binary states cross the wire.
--
-- Columns are `SimpleAggregateFunction(sum, ...)` rather than the full
-- `AggregateFunction(sum, ...)`. Both merge identically for additive sums and
-- counts, but the simple variant lets us insert raw scalars (a Float64, a
-- UInt64) directly: no sumState / countState ceremony, no -State/-Merge
-- combinator dance at read time (plain `sum(RunCount)` works).
--
-- Each immutable terminal event contributes one inserted row. The only repeat
-- is a rare crash/retry re-delivery, which over-counts a single bucket by one
-- simulation's contribution. ADR-034 accepts that explicitly (negligible,
-- non-systematic); replay rebuilds the rollup truncate-first rather than
-- incrementing it.
--
-- Rollup keys = dimensions FINAL at simulation-run-finished time only:
--   (TenantId, BucketStart, Verdict, Status)
-- Verdict is the canonical scenario judgement (success / failure /
-- inconclusive / '') and Status is the run's terminal status enum (SUCCESS /
-- FAILURE / ERROR / '' — the fold's `IN_PROGRESS` etc. never reach this
-- rollup because the map only subscribes to the terminal `finished` event).
-- Higher-cardinality dimensions that are only on the queued/started events
-- (ScenarioSetId, BatchRunId, ScenarioId) live on the slim
-- `simulation_analytics` table — the map projection has no fold-state access
-- and the finished event does not carry them.
--
-- Retention: TenantId is the project id in this codebase, so every
-- (TenantId, BucketStart) pair already belongs to exactly one project. The
-- per-row `_retention_days` column (same column shape as 00032) carries the
-- project's retention; the TTL clause below drops the row `_retention_days`
-- days after its `BucketStart`. Default 308 (MIGRATION_DEFAULT_RETENTION_DAYS)
-- matches every other 00032-managed table.
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for scenarios today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_analytics_rollup
(
    -- Rollup keys — every dimension final at simulation-run-finished time.
    TenantId String CODEC(ZSTD(1)),
    -- Minute bucket of the run's finishedAt (toStartOfMinute) — also the
    -- partition key leaf, so time-range reads prune partitions.
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Scenario judgement verdict (`success` / `failure` / `inconclusive` /
    -- ''). '' when the finished event carries no `results.verdict`.
    Verdict LowCardinality(String),
    -- Terminal run status: `SUCCESS` / `FAILURE` / `ERROR` / ''. The fold's
    -- non-terminal `PENDING` / `QUEUED` / `IN_PROGRESS` never make it onto a
    -- rollup row because the map projection only subscribes to `finished`.
    Status LowCardinality(String),

    -- Raw scenario-run count in the bucket. Inserted as `1` per row.
    RunCount SimpleAggregateFunction(sum, UInt64),
    -- Verdict-derived outcome counters. SuccessCount = `verdict = 'success'`;
    -- FailureCount = `verdict = 'failure'`; InconclusiveCount =
    -- `verdict = 'inconclusive'`. All 0 when verdict is null/''. Sum to a
    -- clean success-rate via:
    --   sum(SuccessCount) / nullIf(sum(SuccessCount) + sum(FailureCount), 0)
    SuccessCount SimpleAggregateFunction(sum, UInt64),
    FailureCount SimpleAggregateFunction(sum, UInt64),
    InconclusiveCount SimpleAggregateFunction(sum, UInt64),
    -- Terminal-status counter: ErrorCount = `status = 'ERROR'` rows. Sum to a
    -- clean error-rate.
    ErrorCount SimpleAggregateFunction(sum, UInt64),

    -- Scenario wall-clock duration in ms (event payload's `durationMs`). 0
    -- when not recorded.
    DurationSum SimpleAggregateFunction(sum, Int64),

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    -- 308 = MIGRATION_DEFAULT_RETENTION_DAYS so any row that somehow misses an
    -- explicit value defaults to the same generous floor every other managed
    -- table uses. Sparse encoding compresses the column to ~zero bytes on parts
    -- where every row holds the same value.
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
-- Partition weekly on the same column the ORDER BY (and time-range reads) lead
-- with. Mirrors simulation_runs (PARTITION BY toYearWeek(StartedAt)) so the
-- rollup ages on the same weekly cadence as its source. `BucketStart` is
-- `DateTime64(3)`; wrap to `Date` so the partition expression is anchored on a
-- concrete date type and partition pruning stays sharp on
-- `WHERE BucketStart BETWEEN ...` reads. Retention is also stamped in whole
-- weeks (PLATFORM_DEFAULT_RETENTION_DAYS = 49, multiples of 7 enforced by
-- retentionDaysSchema), so partitions drop cleanly on the TTL boundary.
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, Verdict, Status)
-- Inline retention TTL: drop a row `_retention_days` days after its bucket.
-- TenantId == projectId, so each bucket is per-project and the project's
-- retention applies cleanly. `BucketStart` is DateTime64(3), so the TTL
-- expression wraps it in `toDateTime` (CH rejects DateTime64 directly in TTL
-- arithmetic). Mirrors trace_analytics_rollup / evaluation_analytics_rollup
-- exactly.
TTL toDateTime(BucketStart) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_analytics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
