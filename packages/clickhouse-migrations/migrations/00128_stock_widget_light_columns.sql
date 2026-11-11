-- +goose Up
-- +goose ENVSUB ON

-- The last attribute values the stock dashboard widgets read from a map, as columns the trace
-- module's projections write (analytics ADR-006): three metadata keys on trace_analytics, written
-- by the traceAnalytics fold, and a new span_analytics table, written by the spanAnalytics map
-- projection, holding the span facts the span widgets read and no map.
--
-- Plain columns with a DEFAULT, no MATERIALIZED expression: the value is the fold's, so an older
-- release that writes the row leaves ''. The background replay steps
-- trace:replay-trace-analytics-widget-columns and trace:replay-span-analytics refold the last 62
-- days once no older writer is left; this file starts no mutation and copies no rows.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database uses the Replicated
-- engine (00001), which propagates DDL to every node on its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataOutcomeReason String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataPromptVersion String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- `metadata.environment`, else `metadata.env`: the fold writes whichever the trace sent.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics
  ADD COLUMN IF NOT EXISTS MetadataEnvironment String DEFAULT '' CODEC(ZSTD(1))
  SETTINGS alter_sync = 1;
-- +goose StatementEnd

-- One row per span, written by the spanAnalytics map projection from the same span event that
-- stored_spans is written from. ReplacingMergeTree(ProjectedAt): a replay or a redelivery writes
-- the span again and the later projection wins. Partitioned and TTL'd on StartTime like
-- stored_spans, so its rows age with the span they describe.
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.span_analytics
(
    TenantId String CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId Nullable(String) CODEC(ZSTD(1)),
    StartTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    EndTime DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    DurationMs UInt64 CODEC(Delta(8), ZSTD(1)),
    SpanName LowCardinality(String),
    SpanKind UInt8 CODEC(ZSTD(1)),
    StatusCode Nullable(UInt8) CODEC(ZSTD(1)),
    Cost Nullable(Float64) CODEC(ZSTD(1)),
    NonBilledCost Nullable(Float64) CODEC(ZSTD(1)),
    -- langwatch.span.type
    SpanType LowCardinality(String) DEFAULT '',
    -- exception.type, else error.type
    ErrorType String DEFAULT '' CODEC(ZSTD(1)),
    -- the length of langwatch.rag.contexts
    RagContextCount UInt32 DEFAULT 0 CODEC(ZSTD(1)),
    -- a hash of langwatch.input: equal inputs share it
    InputHash UInt64 DEFAULT 0 CODEC(ZSTD(1)),
    -- the resource's deployment.environment, else deployment.environment.name
    DeploymentEnvironment String DEFAULT '' CODEC(ZSTD(1)),
    ProjectedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    _retention_days UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}ProjectedAt)
PARTITION BY toYearWeek(StartTime)
ORDER BY (TenantId, TraceId, SpanId)
TTL IF(_retention_days > 0, toDateTime(StartTime) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the rollback is a DROP COLUMN and a DROP TABLE. `up` is idempotent, so `down`
-- is deliberately a no-op.
--
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataOutcomeReason;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataPromptVersion;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics DROP COLUMN IF EXISTS MetadataEnvironment;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.span_analytics;
