-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Migration: Rename Id → ProjectionId across all projection tables
-- ============================================================================
-- All ClickHouse projection tables have a generic `Id` column that stores a
-- deterministic KSUID used as a projection/storage key for idempotent replay.
-- This is NOT the domain entity's identity (each table has its own domain ID:
-- EvaluationId, ScenarioRunId, RunId, SpanId, TraceId).
--
-- Renaming to `ProjectionId` makes the purpose explicit and avoids confusion
-- with domain identity columns.
--
-- ClickHouse does NOT allow RENAME COLUMN on ORDER BY key columns, so
-- experiment_run_items must be dropped and recreated (data is re-derivable
-- from the event log).
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs RENAME COLUMN IF EXISTS Id TO ProjectionId;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs RENAME COLUMN IF EXISTS Id TO ProjectionId;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs RENAME COLUMN IF EXISTS Id TO ProjectionId;
-- +goose StatementEnd

-- experiment_run_items has Id in ORDER BY — must drop/recreate
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items SYNC;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items
(
    ProjectionId String CODEC(ZSTD(1)),
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
    EvaluationInputs Nullable(String) CODEC(ZSTD(3)),
    EvaluationDurationMs Nullable(UInt32),

    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    OccurredAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_target_id TargetId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_result_type ResultType TYPE set(2) GRANULARITY 4,
    INDEX idx_evaluator_id EvaluatorId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}CreatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, RunId, ProjectionId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans RENAME COLUMN IF EXISTS Id TO ProjectionId;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries RENAME COLUMN IF EXISTS Id TO ProjectionId;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs RENAME COLUMN IF EXISTS ProjectionId TO Id;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs RENAME COLUMN IF EXISTS ProjectionId TO Id;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs RENAME COLUMN IF EXISTS ProjectionId TO Id;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans RENAME COLUMN IF EXISTS ProjectionId TO Id;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries RENAME COLUMN IF EXISTS ProjectionId TO Id;
-- +goose StatementEnd

-- Recreate experiment_run_items with original Id column name
-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_run_items SYNC;
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
    ResultType LowCardinality(String),

    DatasetEntry String CODEC(ZSTD(3)),
    Predicted Nullable(String) CODEC(ZSTD(3)),
    TargetCost Nullable(Float64),
    TargetDurationMs Nullable(UInt32),
    TargetError Nullable(String) CODEC(ZSTD(3)),
    TraceId Nullable(String) CODEC(ZSTD(1)),

    EvaluatorId Nullable(String) CODEC(ZSTD(1)),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    EvaluationStatus LowCardinality(String),
    Score Nullable(Float64),
    Label Nullable(String) CODEC(ZSTD(1)),
    Passed Nullable(UInt8),
    EvaluationDetails Nullable(String) CODEC(ZSTD(3)),
    EvaluationCost Nullable(Float64),
    EvaluationInputs Nullable(String) CODEC(ZSTD(3)),
    EvaluationDurationMs Nullable(UInt32),

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
