-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: stored_log_records
-- ============================================================================
-- OpenTelemetry log record storage for distributed tracing.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- - DDL replication handled by Replicated database engine
-- - Data replication handled by ReplicatedReplacingMergeTree when enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_log_records
(
    -- identity
    ProjectionId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),

    -- trace/span correlation
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),

    -- log record fields
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    SeverityNumber UInt8 CODEC(ZSTD(1)),
    SeverityText LowCardinality(String),
    Body String CODEC(ZSTD(1)),

    -- attributes
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- scope
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion Nullable(String) CODEC(ZSTD(1)),

    -- timestamps
    CreatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_severity SeverityNumber TYPE set(256) GRANULARITY 4,
    INDEX idx_time TimeUnixMs TYPE minmax GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, TraceId, SpanId, ProjectionId)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_log_records SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
