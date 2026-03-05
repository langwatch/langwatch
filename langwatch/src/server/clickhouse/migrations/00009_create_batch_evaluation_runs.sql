-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: batch_evaluation_runs
-- ============================================================================
-- Tracks the summary state of batch evaluation runs for the evaluations-v3 feature.
-- This is a projection of batch_evaluation_run aggregate events.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- - DDL replication handled by Replicated database engine
-- - Data replication handled by ReplicatedReplacingMergeTree when enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.batch_evaluation_runs
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    ExperimentId String CODEC(ZSTD(1)),
    WorkflowVersionId Nullable(String) CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    Total UInt32,
    Progress UInt32,
    CompletedCount UInt32,
    FailedCount UInt32,
    TotalCost Nullable(Float64),
    TotalDurationMs Nullable(UInt64),
    AvgScore Nullable(Float64),
    PassRate Nullable(Float64),
    Targets String CODEC(ZSTD(3)),

    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    StoppedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_run_id RunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, ExperimentId, RunId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.batch_evaluation_runs SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
