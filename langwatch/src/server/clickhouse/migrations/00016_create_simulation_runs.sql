-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: simulation_runs
-- ============================================================================
-- Tracks the state of simulation runs (scenario execution).
-- This is a projection of simulation_run aggregate events.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- - DDL replication handled by Replicated database engine
-- - Data replication handled by ReplicatedReplacingMergeTree when enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    ScenarioRunId String CODEC(ZSTD(1)),
    ScenarioId String CODEC(ZSTD(1)),
    BatchRunId String CODEC(ZSTD(1)),
    ScenarioSetId String CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    Status String CODEC(ZSTD(1)),
    Name Nullable(String) CODEC(ZSTD(1)),
    Description Nullable(String) CODEC(ZSTD(1)),
    Messages String CODEC(ZSTD(3)),
    TraceIds String CODEC(ZSTD(1)),

    Verdict Nullable(String) CODEC(ZSTD(1)),
    Reasoning Nullable(String) CODEC(ZSTD(3)),
    MetCriteria String CODEC(ZSTD(1)),
    UnmetCriteria String CODEC(ZSTD(1)),
    Error Nullable(String) CODEC(ZSTD(3)),

    DurationMs Nullable(UInt64),
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_scenario_id ScenarioId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_batch_run_id BatchRunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_scenario_set_id ScenarioSetId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
