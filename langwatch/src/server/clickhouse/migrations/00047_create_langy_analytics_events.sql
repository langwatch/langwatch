-- +goose Up
-- +goose ENVSUB ON

-- Content-free, event-grain analytics for Langy. Operational state lives in
-- Postgres and no command, subscriber, process manager, or realtime UI reads
-- this table. One canonical event maps to one logical row.
--
-- Queue delivery and replay are at-least-once. EventId is the immutable logical
-- identity; ProjectedAt is the replacement version so a later replay with a
-- corrected mapper deterministically supersedes the older row. Readers must
-- still deduplicate by (TenantId, EventId), selecting max(ProjectedAt), because
-- background merges are asynchronous.

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.langy_analytics_events
(
    TenantId       String CODEC(ZSTD(1)),
    EventId        String CODEC(ZSTD(1)),
    EventType      LowCardinality(String),
    EventVersion   LowCardinality(String),

    AggregateId    String CODEC(ZSTD(1)),
    TurnId         Nullable(String) CODEC(ZSTD(1)),
    UserId         Nullable(String) CODEC(ZSTD(1)),
    Role           LowCardinality(Nullable(String)),
    ToolName       LowCardinality(Nullable(String)),
    Outcome        LowCardinality(Nullable(String)),
    Model          LowCardinality(Nullable(String)),
    DurationMs     Nullable(UInt64) CODEC(T64, ZSTD(1)),

    OccurredAt     DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    AcceptedAt     DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    ProjectedAt    DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1)),
    -- Content-free variable-width dimensions only. Identity/timestamps and
    -- fixed-width measures follow the established metering convention and are
    -- not counted by the per-row payload approximation.
    `_size_bytes` UInt32 MATERIALIZED byteSize(
        EventType, EventVersion, AggregateId, TurnId, UserId,
        Role, ToolName, Outcome, Model
    ) CODEC(Delta(4), ZSTD(1)),

    INDEX idx_langy_analytics_event_type EventType TYPE set(32) GRANULARITY 1,
    INDEX idx_langy_analytics_aggregate AggregateId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_langy_analytics_turn TurnId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_langy_analytics_user UserId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}ProjectedAt)
PARTITION BY toYearWeek(toDate(OccurredAt))
-- OccurredAt is immutable for an EventId. Keeping it in the replacement sort
-- key preserves convergence while making tenant time-range analytics scan the
-- primary-key order instead of searching an EventId-only layout.
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
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.langy_analytics_events;
-- +goose ENVSUB OFF
