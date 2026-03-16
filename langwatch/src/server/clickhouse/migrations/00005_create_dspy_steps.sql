-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: dspy_steps
-- ============================================================================
-- Stores DSPy optimization steps (one row per step index within a run).
-- Nested data (predictors, examples, llm_calls) stored as JSON strings.
-- Pre-computed summary columns (LlmCallsTotal/Tokens/Cost) avoid JSON
-- parsing on listing queries.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.dspy_steps
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    ExperimentId String CODEC(ZSTD(1)),
    RunId String CODEC(ZSTD(1)),
    StepIndex String CODEC(ZSTD(1)),

    WorkflowVersionId Nullable(String) CODEC(ZSTD(1)),
    Score Float64,
    Label String CODEC(ZSTD(1)),
    OptimizerName String CODEC(ZSTD(1)),

    OptimizerParameters String CODEC(ZSTD(3)),
    Predictors String CODEC(ZSTD(3)),
    Examples String CODEC(ZSTD(3)),
    LlmCalls String CODEC(ZSTD(3)),

    LlmCallsTotal UInt32,
    LlmCallsTotalTokens UInt64,
    LlmCallsTotalCost Float64,

    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    InsertedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_experiment_id ExperimentId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_run_id RunId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, ExperimentId, RunId, StepIndex)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.dspy_steps SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
