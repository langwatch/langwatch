-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Create suite_runs table for suite run state projection
-- ============================================================================
-- Stores the fold projection for suite run processing pipeline.
-- Tracks batch-level progress of suite runs (scenario counts, pass rate, status).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.suite_runs
(
    ProjectionId   String CODEC(ZSTD(1)),
    TenantId       String CODEC(ZSTD(1)),
    SuiteId        String CODEC(ZSTD(1)),
    BatchRunId     String CODEC(ZSTD(1)),
    SetId          String CODEC(ZSTD(1)),
    Version        LowCardinality(String) CODEC(ZSTD(1)),

    Total          UInt32,
    Progress       UInt32,
    CompletedCount UInt32,
    FailedCount    UInt32,
    ErroredCount   UInt32,
    CancelledCount UInt32,
    PassRateBps    Nullable(Int32),
    Status         LowCardinality(String),

    ScenarioIds    String CODEC(ZSTD(3)),
    Targets        String CODEC(ZSTD(3)),
    RepeatCount    UInt32,
    IdempotencyKey String CODEC(ZSTD(1)),

    CreatedAt      DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt      DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt      Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    FinishedAt     Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_suite_id SuiteId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 4,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1,
    INDEX idx_idempotency_key IdempotencyKey TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, SuiteId, BatchRunId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_runs SYNC;
-- +goose StatementEnd

-- +goose ENVSUB OFF
