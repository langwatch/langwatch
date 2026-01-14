-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Create Evaluation States
-- ============================================================================
-- Tracks current state of each evaluation for stuck detection.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_states
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    EvaluationId String CODEC(ZSTD(1)),
    Version String CODEC(ZSTD(1)),

    EvaluatorId String CODEC(ZSTD(1)),
    EvaluatorType LowCardinality(String),
    EvaluatorName Nullable(String) CODEC(ZSTD(1)),
    TraceId Nullable(String) CODEC(ZSTD(1)),
    IsGuardrail UInt8 DEFAULT 0,

    Status LowCardinality(String),

    Score Nullable(Float64),
    Passed Nullable(UInt8),
    Label Nullable(String) CODEC(ZSTD(1)),
    Details Nullable(String) CODEC(ZSTD(3)),
    Error Nullable(String) CODEC(ZSTD(3)),

    ScheduledAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),
    CompletedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)),

    LastProcessedEventId String CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status Status TYPE set(10) GRANULARITY 4,
    INDEX idx_scheduled_at ScheduledAt TYPE minmax GRANULARITY 1,
    INDEX idx_started_at StartedAt TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
ORDER BY (TenantId, EvaluationId)
SETTINGS index_granularity = 8192;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_states SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
