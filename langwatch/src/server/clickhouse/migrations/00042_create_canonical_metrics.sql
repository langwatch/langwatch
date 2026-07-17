-- +goose Up
-- +goose ENVSUB ON

-- Authoritative, lossless OTLP points. Query columns are duplicated from the
-- compressed canonical payload, but only CanonicalPayload's original UTF-8
-- byte count is stored in _size_bytes.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.metric_data_points
(
    TenantId String CODEC(ZSTD(1)),
    PointId FixedString(64),
    SeriesId FixedString(64),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ResourceAttributesJson String CODEC(ZSTD(3)),
    ResourceAttributeKeys Array(String) CODEC(ZSTD(1)),
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributesJson String CODEC(ZSTD(3)),
    ScopeAttributeKeys Array(String) CODEC(ZSTD(1)),
    MetricName String CODEC(ZSTD(1)),
    MetricDescription String CODEC(ZSTD(1)),
    MetricUnit String CODEC(ZSTD(1)),
    MetricKind LowCardinality(String),
    AggregationTemporality LowCardinality(String),
    IsMonotonic Nullable(Bool),
    PointAttributesJson String CODEC(ZSTD(3)),
    PointAttributeKeys Array(String) CODEC(ZSTD(1)),
    StartTimeUnixNano UInt64,
    TimeUnixNano UInt64,
    TimeUnixMs DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    Flags UInt32,
    ValueType LowCardinality(String),
    ValueInt Nullable(Int64),
    ValueDouble Nullable(Float64),
    Count Nullable(UInt64),
    Sum Nullable(Float64),
    Min Nullable(Float64),
    Max Nullable(Float64),
    ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
    BucketCounts Array(UInt64) CODEC(ZSTD(1)),
    ExponentialScale Nullable(Int32),
    ExponentialZeroThreshold Nullable(Float64),
    ZeroCount Nullable(UInt64),
    PositiveOffset Nullable(Int32),
    PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    NegativeOffset Nullable(Int32),
    NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    SummaryQuantilesJson String CODEC(ZSTD(3)),
    CanonicalPayload String CODEC(ZSTD(6)),
    -- Source measurement time (the millisecond view of TimeUnixNano).
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Server receipt/acceptance time, stable across all points in a request.
    AcceptedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    -- Durable storage-write time, assigned by ClickHouse rather than the app.
    WrittenAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    DedupVersion UInt64,
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}DedupVersion)
PARTITION BY toYearWeek(TimeUnixMs)
ORDER BY (TenantId, SeriesId, TimeUnixMs, TimeUnixNano, PointId)
TTL IF(_retention_days > 0, toDateTime(TimeUnixMs) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Series metadata only. LastSeenAt is both the replacement version and TTL
-- anchor: a late old point cannot replace a newer observation in its partition.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.metric_series
(
    TenantId String CODEC(ZSTD(1)),
    SeriesId FixedString(64),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ResourceAttributesJson String CODEC(ZSTD(3)),
    ResourceAttributeKeys Array(String) CODEC(ZSTD(1)),
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributesJson String CODEC(ZSTD(3)),
    ScopeAttributeKeys Array(String) CODEC(ZSTD(1)),
    MetricName String CODEC(ZSTD(1)),
    MetricDescription String CODEC(ZSTD(1)),
    MetricUnit String CODEC(ZSTD(1)),
    MetricKind LowCardinality(String),
    AggregationTemporality LowCardinality(String),
    IsMonotonic Nullable(Bool),
    PointAttributesJson String CODEC(ZSTD(3)),
    PointAttributeKeys Array(String) CODEC(ZSTD(1)),
    LastSeenAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}LastSeenAt)
PARTITION BY toYearWeek(LastSeenAt)
ORDER BY (TenantId, SeriesId)
TTL IF(_retention_days > 0, toDateTime(LastSeenAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Replaceable 30-second derived rows. Replays and late recomputations converge
-- to the newest complete bucket value rather than incrementing stored state.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.metric_time_rollups
(
    TenantId String CODEC(ZSTD(1)),
    SeriesId FixedString(64),
    MetricName String CODEC(ZSTD(1)),
    MetricUnit String CODEC(ZSTD(1)),
    MetricKind LowCardinality(String),
    AggregationTemporality LowCardinality(String),
    IsMonotonic Nullable(Bool),
    BucketStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    BucketEnd DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    GaugeLast Nullable(Float64),
    Min Nullable(Float64),
    Max Nullable(Float64),
    Sum Nullable(Float64),
    Count UInt64,
    ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
    BucketCounts Array(UInt64) CODEC(ZSTD(1)),
    ExponentialScale Nullable(Int32),
    ExponentialZeroThreshold Nullable(Float64),
    ZeroCount UInt64,
    PositiveOffset Int32,
    PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    NegativeOffset Int32,
    NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    ResetCount UInt32,
    GapCount UInt32,
    SourcePointCount UInt32,
    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(BucketStart)
ORDER BY (TenantId, SeriesId, BucketStart)
TTL IF(_retention_days > 0, toDateTime(BucketStart) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Physically separate, non-billable shadow ledger. It contains identifiers
-- and source-byte counts only: never attributes, values, buckets or payloads.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.metric_usage_estimates
(
    OrganizationId String CODEC(ZSTD(1)),
    TenantId String CODEC(ZSTD(1)),
    PointId FixedString(64),
    SeriesId FixedString(64),
    MetricName String CODEC(ZSTD(1)),
    AcceptedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    AcceptedHour DateTime CODEC(Delta(4), ZSTD(1)),
    CanonicalSourceBytes UInt32,
    WrittenAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),
    DedupVersion UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}DedupVersion)
PARTITION BY toYYYYMM(AcceptedAt)
ORDER BY (OrganizationId, TenantId, PointId)
TTL AcceptedAt + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- Metric events are replay scaffolding, not production-metered storage. Their
-- source bytes are measured only in the physically separate shadow ledger.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  MODIFY COLUMN `_size_bytes` UInt32
    MATERIALIZED if(AggregateType = 'metric', 0, byteSize(EventPayload, ProcessingTraceparent))
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- Cutover deliberately does not migrate the lossy legacy rows. Keep the
-- legacy table during the rolling deployment: old application instances may
-- still write to it. Purging legacy queue jobs and dropping the table require
-- a separate, reviewed post-cutover migration after all old instances stop.

-- +goose Down
-- +goose ENVSUB ON
--
-- IRREVERSIBLE: the canonical metric cutover does not migrate the lossy legacy
-- rows, so there is nothing for a down migration to restore them from. The new
-- event types remain replayable, which is the supported recovery path.
--
-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment below and run manually.
--
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.metric_usage_estimates;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.metric_time_rollups;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.metric_series;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.metric_data_points;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
--   MODIFY COLUMN `_size_bytes` UInt32
--     MATERIALIZED byteSize(EventPayload, ProcessingTraceparent)
--     CODEC(Delta(4), ZSTD(1))
--   SETTINGS alter_sync = 1, mutations_sync = 0;
