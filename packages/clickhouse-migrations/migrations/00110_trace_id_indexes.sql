-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Trace's id indexes (dev/docs/plans/id-index-2026-10-10.md §1): for each of
-- trace_summaries, stored_spans and trace_analytics, an unpartitioned
-- AggregatingMergeTree mapping (TenantId, TraceId) to the time range the trace's
-- rows live in, filled by a view inside every insert. A lookup by trace id reads
-- the index first and bounds its source read to that range.
--
-- FromAt/ToAt keep the source's DateTime64(3), so nothing converts. Retention is
-- copied with "keep forever" (0) written as 65535, so `max` keeps it sticky; the
-- index expires 7 days after its source rows and has no TTL move to cold (absent
-- from TABLE_TTL_CONFIG); it sits on the data disk (local_primary) like its
-- source. Retention changes reach it raise-only through RETENTION_ID_INDEX_TABLES.
--
-- Rows older than the views are filled by the background step
-- `trace:fill-id-indexes`, which then writes each index's ready marker row.
-- New tables and views only: no mutation and no rewrite at deploy.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_id_index
(
  TenantId String,
  TraceId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, TraceId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_id_index_mv
TO ${CLICKHOUSE_DATABASE}.trace_summaries_id_index AS
SELECT TenantId, TraceId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.trace_summaries
GROUP BY TenantId, TraceId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_spans_id_index
(
  TenantId String,
  TraceId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, TraceId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.stored_spans_id_index_mv
TO ${CLICKHOUSE_DATABASE}.stored_spans_id_index AS
SELECT TenantId, TraceId,
  min(StartTime) AS FromAt, max(StartTime) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.stored_spans
GROUP BY TenantId, TraceId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_id_index
(
  TenantId String,
  TraceId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, TraceId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_id_index_mv
TO ${CLICKHOUSE_DATABASE}.trace_analytics_id_index AS
SELECT TenantId, TraceId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.trace_analytics
GROUP BY TenantId, TraceId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.
-- To roll back, uncomment and run manually (views first, then their tables):
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_id_index_mv;
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.stored_spans_id_index_mv;
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_id_index_mv;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_summaries_id_index;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.stored_spans_id_index;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.trace_analytics_id_index;
