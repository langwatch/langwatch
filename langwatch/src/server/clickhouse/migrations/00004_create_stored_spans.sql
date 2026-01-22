-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- Table: stored_spans
-- ============================================================================
-- OpenTelemetry span storage for distributed tracing.
--
-- Engine: ReplacingMergeTree / ReplicatedReplacingMergeTree (based on CLICKHOUSE_CLUSTER)
-- - DDL replication handled by Replicated database engine
-- - Data replication handled by ReplicatedReplacingMergeTree when enabled
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_spans
(
    -- identity
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),

    -- trace/span ids
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId Nullable(String) CODEC(ZSTD(1)),
    ParentTraceId Nullable(String) CODEC(ZSTD(1)),

    -- parent sampling/remote
    ParentIsRemote Nullable(UInt8) CODEC(ZSTD(1)),  -- 0/1
    Sampled UInt8 CODEC(ZSTD(1)),                   -- 0/1

    -- timing
    StartTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EndTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    DurationMs UInt64 CODEC(Delta(8), ZSTD(1)),

    -- span metadata
    SpanName LowCardinality(String),
    SpanKind UInt8 CODEC(ZSTD(1)),
    ServiceName LowCardinality(String),

    -- attributes
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),

    -- status
    StatusCode Nullable(UInt8) CODEC(ZSTD(1)),
    StatusMessage Nullable(String) CODEC(ZSTD(1)),

    -- scope
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion Nullable(String) CODEC(ZSTD(1)),

    -- events
    `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),

    -- links
    `Links.TraceId` Array(String) CODEC(ZSTD(1)),
    `Links.SpanId` Array(String) CODEC(ZSTD(1)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),

    -- dropped counts
    DroppedAttributesCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
    DroppedEventsCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
    DroppedLinksCount UInt32 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),

    -- indexes
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service_name ServiceName TYPE set(1000) GRANULARITY 4,
    INDEX idx_span_name SpanName TYPE set(10000) GRANULARITY 4,
    INDEX idx_status_code StatusCode TYPE set(10) GRANULARITY 4,
    INDEX idx_duration_ms DurationMs TYPE minmax GRANULARITY 1,
    INDEX idx_start_time StartTime TYPE minmax GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_trace_span (TenantId, TraceId, SpanId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}StartTime)
PARTITION BY toYearWeek(StartTime)
ORDER BY (TenantId, TraceId, SpanId)
TTL toDateTime(EndTime) + INTERVAL ${TIERED_STORED_SPANS_TABLE_HOT_DAYS:-2} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_spans SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
