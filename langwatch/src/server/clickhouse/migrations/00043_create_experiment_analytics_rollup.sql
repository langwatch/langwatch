-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- experiment_analytics_rollup — ADR-034 Phase 7 additive analytics fast-path
-- for the EXPERIMENTS pipeline.
--
-- An AggregatingMergeTree written PER-EXPERIMENT-RUN (one row per terminal
-- event) by an APP-SIDE map projection
-- (see experimentAnalyticsRollup.mapProjection.ts), NOT by a ClickHouse
-- materialized view. The projection observes the same per-aggregate-terminal
-- event (`lw.experiment_run.completed`) that the experiment-run fold consumes
-- on completion, so a row's rollup contribution is computed in TypeScript next
-- to the same canonical extraction logic and inserted as plain numbers via
-- JSONEachRow — no AggregateFunction binary states cross the wire.
--
-- Columns are `SimpleAggregateFunction(sum, ...)` rather than the full
-- `AggregateFunction(sum, ...)`. Both merge identically for additive sums and
-- counts, but the simple variant lets us insert raw scalars directly: no
-- sumState / countState ceremony, no -State/-Merge combinator dance at read
-- time (plain `sum(RunCount)` works).
--
-- Each immutable terminal event contributes one inserted row. The only repeat
-- is a rare crash/retry re-delivery, which over-counts a single bucket by one
-- experiment's contribution. ADR-034 accepts that explicitly (negligible,
-- non-systematic); replay rebuilds the rollup truncate-first rather than
-- incrementing it.
--
-- Rollup keys = dimensions FINAL at experiment-run-completed time only:
--   (TenantId, BucketStart, ExperimentId, CompletionMode)
-- ExperimentId is on the completed event payload. CompletionMode is derived
-- by the map projection from which lifecycle timestamp the event carries:
--   * `finished`  — `finishedAt` is set, `stoppedAt` is null (clean finish)
--   * `stopped`   — `stoppedAt` is set (user-requested halt)
--   * `unknown`   — neither timestamp set (defensive; shouldn't normally
--                   reach the rollup but kept rather than dropping the row).
-- Per-row dimensions that need the running fold state (WorkflowVersionId,
-- Targets, counts) live on the slim `experiment_analytics` table.
--
-- ExperimentId is a String (not LowCardinality) because it's a tenant-scoped
-- ULID — cardinality grows with experiment count, not bounded.
-- CompletionMode is LowCardinality (a 3-value enum).
--
-- Retention: TenantId is the project id in this codebase, so every
-- (TenantId, BucketStart) pair already belongs to exactly one project. The
-- per-row `_retention_days` column (same column shape as 00032) carries the
-- project's retention; the TTL clause below drops the row `_retention_days`
-- days after its `BucketStart`. Default 308 (MIGRATION_DEFAULT_RETENTION_DAYS)
-- matches every other 00032-managed table.
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for experiments today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_analytics_rollup
(
    -- Rollup keys — every dimension final at experiment-run-completed time.
    TenantId String CODEC(ZSTD(1)),
    -- Minute bucket of the run's completion (toStartOfMinute) — also the
    -- partition key leaf, so time-range reads prune partitions.
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Experiment id (tenant-scoped ULID). Not LowCardinality — cardinality
    -- grows with the experiment catalog.
    ExperimentId String CODEC(ZSTD(1)),
    -- Completion mode derived from the event payload: `finished` / `stopped` /
    -- `unknown`.
    CompletionMode LowCardinality(String),

    -- Raw experiment-run count in the bucket. Inserted as `1` per row.
    RunCount SimpleAggregateFunction(sum, UInt64),
    -- Per-mode counters derived from CompletionMode.
    FinishedCount SimpleAggregateFunction(sum, UInt64),
    StoppedCount SimpleAggregateFunction(sum, UInt64),

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
-- Partition weekly on the same column the ORDER BY (and time-range reads)
-- lead with. Mirrors experiment_runs (PARTITION BY toYearWeek(StartedAt)) so
-- the rollup ages on the same weekly cadence as its source.
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, ExperimentId, CompletionMode)
-- Inline retention TTL: drop a row `_retention_days` days after its bucket.
TTL toDateTime(BucketStart) + INTERVAL _retention_days DAY DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_analytics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
