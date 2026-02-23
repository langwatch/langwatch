-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.billable_events SYNC;

-- +goose StatementEnd
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.billable_events
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    EventId String CODEC(ZSTD(1)),
    EventType LowCardinality(String),
    DeduplicationKey String CODEC(ZSTD(1)),
    DeduplicationKeyHash UInt64 MATERIALIZED cityHash64(DeduplicationKey),
    EventTimestamp DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(EventTimestamp)
ORDER BY (OrganizationId, TenantId, DeduplicationKeyHash)
SETTINGS index_granularity = 8192, storage_policy = 'local_primary';

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.billable_events SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
