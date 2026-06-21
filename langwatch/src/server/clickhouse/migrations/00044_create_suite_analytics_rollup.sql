-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- suite_analytics_rollup — ADR-034 Phase 7 additive analytics fast-path for
-- the SUITE pipeline.
--
-- An AggregatingMergeTree written PER-ITEM (one row per terminal
-- `lw.suite_run.item_completed` event) by an APP-SIDE map projection (see
-- suiteAnalyticsRollup.mapProjection.ts), NOT by a ClickHouse materialized
-- view. The suite pipeline has no run-level terminal event; the slim fold
-- derives "this is the item that ended the run" from its own state. The
-- map projection has no fold-state access, so it fires per ITEM completion
-- and lets ClickHouse merge the per-item rows into per-suite-run sums.
--
-- Columns are `SimpleAggregateFunction(sum, ...)` rather than the full
-- `AggregateFunction(sum, ...)`. Both merge identically for additive sums and
-- counts, but the simple variant lets us insert raw scalars directly: no
-- sumState / countState ceremony, no -State/-Merge combinator dance at read
-- time (plain `sum(ItemCount)` works).
--
-- Each immutable item event contributes one inserted row. Re-delivery
-- over-counts by one item's contribution; ADR-034 accepts that explicitly.
-- Replay rebuilds the rollup truncate-first.
--
-- Rollup keys = dimensions FINAL at item-completed time only:
--   (TenantId, BucketStart, SuiteId, Verdict)
-- SuiteId comes off every item-completed event indirectly (the item's
-- aggregateId is the batchRunId; the suite id is carried on the item-completed
-- event payload? — no, only batchRunId/scenarioId/scenarioRunId are on the
-- item event. The map projection looks up SuiteId from the suite-run fold's
-- write-time context: NOT available without state. We therefore put a slim
-- SUITE-LEVEL identifier on the rollup that IS available on every item: the
-- BatchRunId itself. Suite-level group-bys can join through suite_runs (the
-- legacy table) which is keyed on (TenantId, ScenarioSetId, BatchRunId).
-- Verdict is the item's verdict (`success` / `failure` / `inconclusive` / '').
--
-- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
--
-- Phase 7 is WRITE-SIDE ONLY: there is no analytics registry metric or UI
-- consumer for suites today. Data accumulates silently; future work
-- (registry + UI) will consume it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.suite_analytics_rollup
(
    -- Rollup keys — every dimension final at item-completed time.
    TenantId String CODEC(ZSTD(1)),
    -- Minute bucket of the item's completion (toStartOfMinute) — also the
    -- partition key leaf, so time-range reads prune partitions.
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- BatchRunId — the only stable suite-level id on the item-completed event.
    -- Suite-level group-bys join through suite_runs by BatchRunId.
    BatchRunId String CODEC(ZSTD(1)),
    -- Item verdict (`success` / `failure` / `inconclusive` / ''). '' when the
    -- item-completed event carries no verdict.
    Verdict LowCardinality(String),

    -- Raw item count in the bucket. Inserted as `1` per row.
    ItemCount SimpleAggregateFunction(sum, UInt64),
    -- Verdict-derived outcome counters.
    SuccessCount SimpleAggregateFunction(sum, UInt64),
    FailureCount SimpleAggregateFunction(sum, UInt64),
    InconclusiveCount SimpleAggregateFunction(sum, UInt64),
    -- Item-status counter: ErrorCount = `status = 'ERROR'` rows.
    ErrorCount SimpleAggregateFunction(sum, UInt64),

    -- Item wall-clock duration in ms (event payload's `durationMs`). 0 when
    -- not recorded.
    DurationSum SimpleAggregateFunction(sum, Int64),

    -- Per-row retention (matches 00032's UInt16 + Delta+ZSTD codec + 308 default).
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
-- Partition weekly on the same column the ORDER BY (and time-range reads)
-- lead with. Mirrors suite_runs (PARTITION BY toYearWeek(StartedAt)) so the
-- rollup ages on the same weekly cadence.
PARTITION BY toYearWeek(toDate(BucketStart))
ORDER BY (TenantId, BucketStart, BatchRunId, Verdict)
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
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_analytics_rollup;
-- +goose StatementEnd

-- +goose ENVSUB OFF
