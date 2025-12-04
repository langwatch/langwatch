-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Initial Migration
-- ============================================================================
--
-- Configuration via environment variables:
--   CLICKHOUSE_REPLICATED=true    Use ReplicatedMergeTree for HA (Keeper required)
--   TIERED_HOT_DAYS=7             Days to keep data on hot storage before cold
--
-- ReplicatedMergeTree syncs table structure via Keeper (no ON CLUSTER needed)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_DATABASE};

-- ============================================================================
-- Table: event_log
-- ============================================================================
-- Stores immutable events with tenant isolation and aggregate grouping.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.event_log
(
    TenantId String CODEC(ZSTD(1)),
    IdempotencyKey String CODEC(ZSTD(1)),
    AggregateType LowCardinality(String),
    AggregateId String CODEC(ZSTD(1)),
    EventId String CODEC(ZSTD(1)),
    EventType LowCardinality(String),
    EventTimestamp DateTime64(3) CODEC(Delta(4), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(4), ZSTD(1)),
    EventPayload String CODEC(ZSTD(3)),
    ProcessingTraceparent String DEFAULT '' CODEC(ZSTD(1)),

    INDEX idx_event_id EventId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_event_timestamp EventTimestamp TYPE minmax GRANULARITY 1,
    INDEX idx_idempotency_key IdempotencyKey TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_aggregate_timestamp (TenantId, AggregateType, AggregateId, EventTimestamp) TYPE minmax GRANULARITY 1,
    INDEX idx_tenant_aggregate_event_id (TenantId, AggregateType, AggregateId, EventId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
PARTITION BY TenantId, toYYYYMM(EventTimestamp)
ORDER BY (TenantId, AggregateType, AggregateId, EventTimestamp, EventId)
TTL toDateTime(EventTimestamp) + INTERVAL ${TIERED_HOT_DAYS:-7} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 'tiered';

-- ============================================================================
-- Table: processor_checkpoints
-- ============================================================================
-- Tracks event processing state for each processor/handler.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.processor_checkpoints
(
    CheckpointKey String CODEC(ZSTD(1)),
    ProcessorName String CODEC(ZSTD(1)),
    ProcessorType LowCardinality(String),
    EventId String CODEC(ZSTD(1)),
    Status LowCardinality(String),
    EventTimestamp UInt64 CODEC(Delta(8), ZSTD(1)),
    SequenceNumber UInt64 CODEC(Delta(8), ZSTD(1)),
    ProcessedAt Nullable(UInt64) CODEC(ZSTD(1)),
    FailedAt Nullable(UInt64) CODEC(ZSTD(1)),
    ErrorMessage Nullable(String) CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    AggregateType LowCardinality(String),
    AggregateId String CODEC(ZSTD(1)),
    UpdatedAt DateTime DEFAULT now(),

    INDEX idx_checkpoint_key CheckpointKey TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_processor_name ProcessorName TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_status Status TYPE set(100) GRANULARITY 4,
    INDEX idx_tenant_aggregate_status (TenantId, AggregateType, Status) TYPE set(100) GRANULARITY 4,
    INDEX idx_tenant_aggregate_sequence (TenantId, CheckpointKey, SequenceNumber) TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY (TenantId, AggregateType)
ORDER BY (TenantId, CheckpointKey)
SETTINGS index_granularity = 8192, storage_policy = 'tiered';

-- ============================================================================
-- Table: ingested_spans
-- ============================================================================
-- OpenTelemetry span storage for distributed tracing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.ingested_spans
(
    Id String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId String CODEC(ZSTD(1)),
    TraceState String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    Timestamp DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    Duration Int64 CODEC(Delta(8), ZSTD(1)),
    SpanName LowCardinality(String),
    SpanKind LowCardinality(String),
    ServiceName LowCardinality(String),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    StatusCode LowCardinality(String),
    StatusMessage String CODEC(ZSTD(1)),
    `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `Links.TraceId` Array(String) CODEC(ZSTD(1)),
    `Links.SpanId` Array(String) CODEC(ZSTD(1)),
    `Links.TraceState` Array(String) CODEC(ZSTD(1)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id SpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_service_name ServiceName TYPE set(1000) GRANULARITY 4,
    INDEX idx_span_name SpanName TYPE set(10000) GRANULARITY 4,
    INDEX idx_status_code StatusCode TYPE set(10) GRANULARITY 4,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_trace_span (TenantId, TraceId, SpanId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}Timestamp)
PARTITION BY TenantId, toYYYYMM(Timestamp)
ORDER BY (TenantId, TraceId, SpanId)
TTL toDateTime(Timestamp) + INTERVAL ${TIERED_HOT_DAYS:-7} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 'tiered';

-- ============================================================================
-- Table: trace_projections
-- ============================================================================
-- Aggregated trace-level projections for dashboards and analytics.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_projections
(
    Id String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    Version DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    IOSchemaVersion LowCardinality(String),
    ComputedInput Nullable(String) CODEC(ZSTD(3)),
    ComputedOutput Nullable(String) CODEC(ZSTD(3)),
    ComputedMetadata Map(String, String) CODEC(ZSTD(1)),
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

    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_total_duration TotalDurationMs TYPE minmax GRANULARITY 1,
    INDEX idx_created_at CreatedAt TYPE minmax GRANULARITY 1,
    INDEX idx_models Models TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_topic_id TopicId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_has_error ContainsErrorStatus TYPE set(2) GRANULARITY 4,
    INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_trace_version (TenantId, TraceId, Version) TYPE minmax GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}LastUpdatedAt)
PARTITION BY TenantId, toYYYYMM(CreatedAt)
ORDER BY (TenantId, TraceId)
TTL toDateTime(CreatedAt) + INTERVAL ${TIERED_HOT_DAYS:-7} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1, storage_policy = 'tiered';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_projections SYNC;
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.ingested_spans SYNC;
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.processor_checkpoints SYNC;
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.event_log SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
