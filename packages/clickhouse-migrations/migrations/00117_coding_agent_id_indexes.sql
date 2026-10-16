-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Coding agent's id indexes (dev/docs/plans/id-index-2026-10-10.md): per
-- (TenantId, id), the earliest and latest source time and the longest
-- retention, so a lookup by id alone reads only the partitions the id lives in.
-- Unpartitioned and never tiered cold; each index expires seven days after the
-- latest row it points at. A view fills it inside every insert; rows older than
-- the view come from the owner's background step (coding-agent:fill-id-indexes).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions_id_index
(
  TenantId String,
  SessionId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, SessionId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions_id_index_mv
TO ${CLICKHOUSE_DATABASE}.coding_agent_sessions_id_index AS
SELECT TenantId, SessionId,
  min(StartedAt) AS FromAt, max(StartedAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.coding_agent_sessions
GROUP BY TenantId, SessionId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events_id_index
(
  TenantId String,
  SessionId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, SessionId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events_id_index_mv
TO ${CLICKHOUSE_DATABASE}.coding_agent_session_events_id_index AS
SELECT TenantId, SessionId,
  min(TimeUnixMs) AS FromAt, max(TimeUnixMs) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.coding_agent_session_events
GROUP BY TenantId, SessionId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions_id_index
(
  TenantId String,
  TraceId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, TraceId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions_id_index_mv
TO ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions_id_index AS
SELECT TenantId, TraceId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions
GROUP BY TenantId, TraceId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The indexes are rebuildable
-- by the owner's background step.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_sessions_id_index;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_session_events_id_index;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.coding_agent_trace_sessions_id_index;
-- +goose StatementEnd
