-- +goose Up
-- +goose ENVSUB ON

-- IDs and timing only: this audit must never retain trace/span/message content.
-- EventId is the logical identity and ProjectedAt is the replacement version.

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.automation_audit
(
    TenantId        String CODEC(ZSTD(1)),
    EventId         String CODEC(ZSTD(1)),
    TriggerId       String CODEC(ZSTD(1)),
    TraceId         String CODEC(ZSTD(1)),
    ActionClass     LowCardinality(String),
    OccurredAt      DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    ProjectedAt     DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    `_size_bytes` UInt32 MATERIALIZED byteSize(EventId, TriggerId, TraceId, ActionClass)
      CODEC(Delta(4), ZSTD(1)),

    INDEX idx_automation_audit_trigger TriggerId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_automation_audit_trace TraceId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}ProjectedAt)
PARTITION BY toYearWeek(toDate(OccurredAt))
ORDER BY (TenantId, OccurredAt, EventId)
TTL IF(
    `_retention_days` > 0,
    toDateTime(OccurredAt) + toIntervalDay(`_retention_days`),
    toDateTime('2106-01-01')
) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- Down migration intentionally disabled to prevent accidental data loss.
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.automation_audit;
-- +goose ENVSUB OFF
