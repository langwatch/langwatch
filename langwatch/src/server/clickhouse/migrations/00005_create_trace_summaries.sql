-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Create Trace Overviews
-- ============================================================================
-- ============================================================================

-- ============================================================================
-- Table: trace_summaries
-- ============================================================================
-- Aggregated trace-level overviews for dashboards and analytics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    Version DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    IOSchemaVersion LowCardinality(String),
    ComputedInput Nullable(String) CODEC(ZSTD(3)),
    ComputedOutput Nullable(String) CODEC(ZSTD(3)),
    ComputedAttributes Map(String, String) CODEC(ZSTD(1)),
    TimeToFirstTokenMs Nullable(UInt32) CODEC(Delta(4), ZSTD(1)),
    TimeToLastTokenMs Nullable(UInt32) CODEC(Delta(4), ZSTD(1)),
    TotalDurationMs Int64 CODEC(Delta(8), ZSTD(1)),
    TokensPerSecond Nullable(UInt32) CODEC(ZSTD(1)),
    SpanCount UInt32 CODEC(ZSTD(1)),
    ContainsErrorStatus Bool,
    ContainsOKStatus Bool,
    Models Array(String) CODEC(ZSTD(1)),
    TotalPromptTokenCount Nullable(UInt32) CODEC(ZSTD(1)),
    TotalCompletionTokenCount Nullable(UInt32) CODEC(ZSTD(1)),
    TopicId Nullable(String) CODEC(ZSTD(1)),
    SubTopicId Nullable(String) CODEC(ZSTD(1)),
    HasAnnotation Nullable(Bool),
    CreatedAt DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    LastUpdatedAt DateTime64(9) CODEC(Delta(8), ZSTD(1)),

    -- Reserved trace metadata
    ThreadId Nullable(String) CODEC(ZSTD(1)),
    UserId Nullable(String) CODEC(ZSTD(1)),
    CustomerId Nullable(String) CODEC(ZSTD(1)),
    Labels Array(String) CODEC(ZSTD(1)),
    PromptIds Array(String) CODEC(ZSTD(1)),
    PromptVersionIds Array(String) CODEC(ZSTD(1)),

    -- Cost metrics
    TotalCost Nullable(Float64) CODEC(ZSTD(1)),
    TokensEstimated Bool,

    -- Error details
    ErrorMessage Nullable(String) CODEC(ZSTD(1)),

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_total_duration TotalDurationMs TYPE minmax GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1,
    INDEX idx_models Models TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_topic_id TopicId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_has_error ContainsErrorStatus TYPE set(2) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_trace_version (TenantId, TraceId, Version) TYPE minmax GRANULARITY 1,
    INDEX idx_thread_id ThreadId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_user_id UserId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_customer_id CustomerId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_labels Labels TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}LastUpdatedAt)
PARTITION BY toYearWeek(CreatedAt)
ORDER BY (TenantId, TraceId)
TTL toDateTime(LastUpdatedAt) + INTERVAL ${TIERED_TRACE_SUMMARIES_TABLE_HOT_DAYS:-2} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
