-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: analytics_trace_facts
-- ============================================================================
-- Denormalized fact table for trace-level analytics.
-- One row per trace, pre-aggregated from trace_summaries + stored_spans data.
-- Eliminates JOINs and dedup at query time for analytics queries.
--
-- Populated by the analyticsTraceFacts fold projection in the trace-processing pipeline.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.analytics_trace_facts
(
    -- Identity
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Known metadata as top-level columns (fast, indexed)
    UserId LowCardinality(String) CODEC(ZSTD(1)),
    ThreadId LowCardinality(String) CODEC(ZSTD(1)),
    CustomerId LowCardinality(String) CODEC(ZSTD(1)),
    Labels Array(String) CODEC(ZSTD(1)),
    TopicId LowCardinality(Nullable(String)) CODEC(ZSTD(1)),
    SubTopicId LowCardinality(Nullable(String)) CODEC(ZSTD(1)),

    -- Dynamic/custom metadata (semconv keyed, values >256 chars omitted at projection time)
    Metadata Map(String, String) CODEC(ZSTD(1)),

    -- Performance metrics
    TotalCost Nullable(Float64),
    TotalDurationMs Int64,
    TotalPromptTokens Nullable(UInt32),
    TotalCompletionTokens Nullable(UInt32),
    TokensPerSecond Nullable(UInt32),
    TimeToFirstTokenMs Nullable(UInt32),
    ContainsError UInt8,
    HasAnnotation Nullable(UInt8),
    SpanCount UInt32,

    -- Per-model breakdown (parallel arrays, pre-aggregated per unique model)
    ModelNames Array(LowCardinality(String)) CODEC(ZSTD(1)),
    ModelPromptTokens Array(UInt32) CODEC(ZSTD(1)),
    ModelCompletionTokens Array(UInt32) CODEC(ZSTD(1)),
    ModelCosts Array(Float64) CODEC(ZSTD(1)),

    -- Events (parallel arrays)
    EventTypes Array(String) CODEC(ZSTD(1)),
    EventScoreKeys Array(String) CODEC(ZSTD(1)),
    EventScoreValues Array(Float64) CODEC(ZSTD(1)),
    EventDetailKeys Array(String) CODEC(ZSTD(1)),
    EventDetailValues Array(String) CODEC(ZSTD(1)),
    ThumbsUpDownVote Nullable(Int8),

    -- RAG documents
    RAGDocumentIds Array(String) CODEC(ZSTD(1)),
    RAGDocumentContents Array(String) CODEC(ZSTD(3)),

    -- Timestamps
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_occurred_at OccurredAt TYPE minmax GRANULARITY 1,
    INDEX idx_contains_error ContainsError TYPE set(2) GRANULARITY 4,
    INDEX idx_user_id UserId TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_topic_id TopicId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, OccurredAt, TraceId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};

-- +goose StatementEnd
-- +goose StatementBegin

-- ============================================================================
-- Table: analytics_evaluation_facts
-- ============================================================================
-- Denormalized fact table for evaluation-level analytics.
-- One row per evaluation, with best-effort denormalized trace context.
-- Eliminates JOINs to evaluation_runs and dedup at query time.
--
-- Populated by the analyticsEvaluationFacts fold projection in the evaluation-processing pipeline.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.analytics_evaluation_facts
(
    -- Identity
    TenantId String CODEC(ZSTD(1)),
    EvaluationId String CODEC(ZSTD(1)),
    TraceId Nullable(String) CODEC(ZSTD(1)),
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Evaluator info
    EvaluatorId String CODEC(ZSTD(1)),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    EvaluatorType LowCardinality(String) CODEC(ZSTD(1)),
    IsGuardrail UInt8,

    -- Results
    Score Nullable(Float64),
    Passed Nullable(UInt8),
    Label Nullable(String) CODEC(ZSTD(1)),
    Status LowCardinality(String) CODEC(ZSTD(1)),

    -- Best-effort denormalized trace context (nullable, populated when available)
    UserId Nullable(String) CODEC(ZSTD(1)),
    ThreadId Nullable(String) CODEC(ZSTD(1)),
    TopicId Nullable(String) CODEC(ZSTD(1)),
    CustomerId Nullable(String) CODEC(ZSTD(1)),

    -- Timestamps
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_evaluation_id EvaluationId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_occurred_at OccurredAt TYPE minmax GRANULARITY 1,
    INDEX idx_evaluator_type EvaluatorType TYPE set(20) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 1,
    INDEX idx_evaluator_id EvaluatorId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, OccurredAt, EvaluationId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.analytics_trace_facts SYNC;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.analytics_evaluation_facts SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
