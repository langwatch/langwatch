-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Reorder ORDER BY keys for experiment_runs and experiment_run_items
-- ============================================================================
-- The previous ORDER BY keys were optimized for experiment-scoped queries:
--   experiment_runs:      (TenantId, ExperimentId, RunId)
--   experiment_run_items: (TenantId, ExperimentId, RunId, Id)
--
-- The new ORDER BY keys optimize for run-scoped queries (most common access pattern):
--   experiment_runs:      (TenantId, RunId, ExperimentId)
--   experiment_run_items: (TenantId, RunId, Id)
--
-- A bloom filter index on ExperimentId is added to experiment_run_items
-- to maintain fast experiment-scoped lookups.
-- ============================================================================

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items SYNC;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs
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

    TotalScoreSum Float64 DEFAULT 0,
    ScoreCount UInt32 DEFAULT 0,
    PassedCount UInt32 DEFAULT 0,
    PassFailCount UInt32 DEFAULT 0,

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    FinishedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    StoppedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, RunId, ExperimentId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items
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

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    OccurredAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_target_id TargetId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_result_type ResultType TYPE set(2) GRANULARITY 4,
    INDEX idx_evaluator_id EvaluatorId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, RunId, Id)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Revert to original ORDER BY keys by dropping and recreating
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs SYNC;
-- +goose StatementEnd
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items SYNC;
-- +goose StatementEnd

-- +goose ENVSUB OFF
