-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Initial Migration
-- ============================================================================
-- ============================================================================

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
    EventVersion LowCardinality(String),
    EventTimestamp UInt64 CODEC(Delta(8), ZSTD(1)),

    CreatedAt DateTime DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    EventPayload String CODEC(ZSTD(3)),
    ProcessingTraceparent String DEFAULT '' CODEC(ZSTD(1)),

    INDEX idx_event_id EventId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_event_timestamp EventTimestamp TYPE minmax GRANULARITY 1,
    INDEX idx_idempotency_key IdempotencyKey TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant_aggregate_event_id (TenantId, AggregateType, AggregateId, EventId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
PARTITION BY (AggregateType, toYearWeek(toDateTime64(EventTimestamp / 1000, 3)))
ORDER BY (TenantId, AggregateType, AggregateId, EventTimestamp, EventId)
TTL toDateTime64(EventTimestamp / 1000, 3) + INTERVAL ${TIERED_EVENT_LOG_TABLE_HOT_DAYS:-2} DAY TO VOLUME 'cold'
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.event_log SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
