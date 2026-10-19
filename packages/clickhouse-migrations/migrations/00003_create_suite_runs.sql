-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: suite_runs
-- ============================================================================
-- Tracks the aggregate state of suite runs (batch execution of scenarios).
-- This is a fold projection of suite_run aggregate events.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.suite_runs
(
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    SuiteRunId String CODEC(ZSTD(1)),
    BatchRunId String CODEC(ZSTD(1)),
    ScenarioSetId String CODEC(ZSTD(1)),
    SuiteId String CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    Status String CODEC(ZSTD(1)),
    Total UInt32,
    StartedCount UInt32,
    CompletedCount UInt32,
    FailedCount UInt32,
    Progress UInt32,
    PassRateBps Nullable(Int32),
    PassedCount UInt32,
    GradedCount UInt32,

    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_scenario_set_id ScenarioSetId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_suite_id SuiteId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(StartedAt)
ORDER BY (TenantId, ScenarioSetId, BatchRunId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.suite_runs SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
