-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ============================================================================
-- LangWatch ClickHouse Schema - Create Daily Trace Counts
-- ============================================================================
-- ============================================================================

-- ============================================================================
-- Table: daily_trace_counts
-- ============================================================================
-- Aggregated daily trace counts per tenant for usage statistics.
-- Uses AggregatingMergeTree with uniqState for idempotent unique counting.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.daily_trace_counts
(
    TenantId String CODEC(ZSTD(1)),
    DateUtc Date CODEC(Delta(2), ZSTD(1)),
    TraceCount AggregateFunction(uniq, String),
    LastUpdatedAt DateTime64(9) CODEC(Delta(8), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(DateUtc)
ORDER BY (TenantId, DateUtc)
SETTINGS index_granularity = 8192;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.daily_trace_counts SYNC;

-- +goose StatementEnd
-- +goose ENVSUB OFF
