-- +goose Up
-- +goose ENVSUB ON

-- Authoritative post-policy OTLP log records. CanonicalPayload preserves typed
-- bodies and attributes; duplicated columns exist only for demonstrated reads.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.log_records
(
    TenantId String CODEC(ZSTD(1)),
    RecordId FixedString(64),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ResourceAttributesJson String CODEC(ZSTD(3)),
    ResourceAttributesFlatJson String CODEC(ZSTD(3)),
    ResourceAttributeKeys Array(String) CODEC(ZSTD(1)),
    ResourceDroppedAttributesCount UInt32,
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributesJson String CODEC(ZSTD(3)),
    ScopeAttributeKeys Array(String) CODEC(ZSTD(1)),
    ScopeDroppedAttributesCount UInt32,
    WireTraceId String CODEC(ZSTD(1)),
    WireSpanId String CODEC(ZSTD(1)),
    CorrelationTraceId String CODEC(ZSTD(1)),
    CorrelationSpanId String CODEC(ZSTD(1)),
    CorrelationSource LowCardinality(String),
    TimeUnixNano UInt64,
    ObservedTimeUnixNano UInt64,
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    SeverityNumber UInt8,
    SeverityText LowCardinality(String),
    BodyType LowCardinality(String),
    BodyJson String CODEC(ZSTD(3)),
    BodyText Nullable(String) CODEC(ZSTD(3)),
    AttributesJson String CODEC(ZSTD(3)),
    AttributesFlatJson String CODEC(ZSTD(3)),
    AttributeKeys Array(String) CODEC(ZSTD(1)),
    DroppedAttributesCount UInt32,
    Flags UInt32,
    EventName String CODEC(ZSTD(1)),
    ProviderKind LowCardinality(String),
    ProviderEventKind LowCardinality(String),
    ProviderEventSequence String CODEC(ZSTD(1)),
    ProviderSessionId String CODEC(ZSTD(1)),
    ProviderConversationId String CODEC(ZSTD(1)),
    ProviderPromptId String CODEC(ZSTD(1)),
    PiiRedactionLevel LowCardinality(String),
    CanonicalPayload String CODEC(ZSTD(6)),
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    AcceptedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    WrittenAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    DedupVersion UInt64,
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    INDEX idx_log_record_id RecordId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_log_span_id CorrelationSpanId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_log_severity SeverityNumber TYPE set(256) GRANULARITY 4,
    INDEX idx_log_attribute_keys AttributeKeys TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_log_provider_session ProviderSessionId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}DedupVersion)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, CorrelationTraceId, TimeUnixMs, RecordId)
TTL IF(_retention_days > 0, toDateTime(TimeUnixMs) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Non-billable usage-estimation ledger. No body, attributes, or canonical
-- payload are copied here.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.log_usage_estimates
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    RecordId FixedString(64),
    ProviderKind LowCardinality(String),
    AcceptedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    AcceptedHour DateTime CODEC(Delta(4), ZSTD(1)),
    CanonicalSourceBytes UInt32,
    WrittenAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    DedupVersion UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}DedupVersion)
PARTITION BY toYYYYMM(AcceptedAt)
ORDER BY (OrganizationId, TenantId, RecordId)
TTL AcceptedAt + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Canonical log events are replay scaffolding. Customer-visible storage is
-- counted once from log_records rather than from both event and projection.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  MODIFY COLUMN `_size_bytes` UInt32
    MATERIALIZED if(AggregateType IN ('metric', 'log'), 0, byteSize(EventPayload, ProcessingTraceparent))
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- The lossy stored_log_records table remains for rolling-deployment reads and
-- drains naturally under its existing TTL. New code no longer writes it.

-- +goose Down
-- Canonical log cutover is intentionally irreversible; event payloads remain
-- replayable and the legacy table is not modified or dropped.
--
-- The event_log._size_bytes change above IS reversible. To restore the state
-- 00049 left it in (metric folded out, log still billable), uncomment and run
-- manually. Down migrations stay commented out to prevent accidental loss.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.log_usage_estimates;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.log_records;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
--   MODIFY COLUMN `_size_bytes` UInt32
--     MATERIALIZED if(AggregateType = 'metric', 0, byteSize(EventPayload, ProcessingTraceparent))
--     CODEC(Delta(4), ZSTD(1))
--   SETTINGS alter_sync = 1, mutations_sync = 0;

