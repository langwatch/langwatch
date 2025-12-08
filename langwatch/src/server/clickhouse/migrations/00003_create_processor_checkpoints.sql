-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Initial Migration
-- ============================================================================
-- ============================================================================

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
    EventTimestamp DateTime64(3) CODEC(Delta(4), ZSTD(1)),
    SequenceNumber Int64 CODEC(Delta(8), ZSTD(1)),
    ProcessedAt Nullable(DateTime64(3)) CODEC(Delta(4), ZSTD(1)),
    FailedAt Nullable(DateTime64(3)) CODEC(Delta(4), ZSTD(1)),
    ErrorMessage Nullable(String) CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    AggregateType LowCardinality(String),
    AggregateId String CODEC(ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(4), ZSTD(1)),

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

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.processor_checkpoints SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
