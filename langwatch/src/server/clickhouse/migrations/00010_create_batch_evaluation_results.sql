-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: batch_evaluation_results
-- ============================================================================
-- Query-optimized read model for batch evaluation results (individual rows).
-- Stores denormalized target and evaluator results for efficient filtering/sorting.
-- This is an event handler materialized view, not a projection.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- - DDL replication handled by Replicated database engine
-- - Data replication handled by ReplicatedReplacingMergeTree when enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.batch_evaluation_results
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    ExperimentId String CODEC(ZSTD(1)),

    RowIndex UInt32,
    TargetId String CODEC(ZSTD(1)),
    ResultType LowCardinality(String),  -- 'target' or 'evaluator'

    -- Target result fields
    DatasetEntry String CODEC(ZSTD(3)),
    Predicted Nullable(String) CODEC(ZSTD(3)),
    TargetCost Nullable(Float64),
    TargetDurationMs Nullable(UInt32),
    TargetError Nullable(String) CODEC(ZSTD(3)),
    TraceId Nullable(String) CODEC(ZSTD(1)),

    -- Evaluator result fields
    EvaluatorId Nullable(String) CODEC(ZSTD(1)),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    EvaluationStatus LowCardinality(String),
    Score Nullable(Float64),
    Label Nullable(String) CODEC(ZSTD(1)),
    Passed Nullable(UInt8),
    EvaluationDetails Nullable(String) CODEC(ZSTD(3)),
    EvaluationCost Nullable(Float64),

    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_run_id RunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_target_id TargetId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_result_type ResultType TYPE set(2) GRANULARITY 4,
    INDEX idx_evaluator_id EvaluatorId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, ExperimentId, RunId, Id)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.batch_evaluation_results SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
