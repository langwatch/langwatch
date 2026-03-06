-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Create suite_run_items table for per-scenario item projection
-- ============================================================================
-- Stores individual scenario lifecycle data within suite runs.
-- Uses ReplacingMergeTree so in-progress items can be updated to terminal state.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.suite_run_items
(
    ProjectionId      String CODEC(ZSTD(1)),
    TenantId          String CODEC(ZSTD(1)),
    SuiteId           String CODEC(ZSTD(1)),
    BatchRunId        String CODEC(ZSTD(1)),
    ScenarioRunId     String CODEC(ZSTD(1)),
    ScenarioId        String CODEC(ZSTD(1)),
    TargetReferenceId String CODEC(ZSTD(1)),
    TargetType        LowCardinality(String) CODEC(ZSTD(1)),
    Status            LowCardinality(String),
    Verdict           Nullable(String) CODEC(ZSTD(1)),
    DurationMs        Nullable(UInt32),

    StartedAt         Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    FinishedAt        Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt         DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_suite_id SuiteId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_scenario_run_id ScenarioRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(UpdatedAt)
ORDER BY (TenantId, SuiteId, BatchRunId, ScenarioRunId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_run_items SYNC;
-- +goose StatementEnd

-- +goose ENVSUB OFF
