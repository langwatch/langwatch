-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Evaluation's second id index (dev/docs/plans/id-index-2026-10-10.md): the
-- runs of one trace, so a read by TraceId alone reads only the partitions its
-- evaluations live in. evaluation_runs is ordered by (TenantId, EvaluationId),
-- so the first index cannot serve it. Shaped as 00112: per (TenantId, TraceId)
-- the ScheduledAt range and the longest retention.
--
-- evaluation_runs expires on UpdatedAt, not on its partition column, so the
-- index also carries RetainAt = max(UpdatedAt) and its TTL runs off that.
-- Source TraceId is Nullable(String) and an index key cannot be, so the view
-- and the owner's fill skip rows with no trace. Unpartitioned, never tiered
-- cold. A view fills it inside every insert; older rows come from the owner's
-- background step (evaluation:fill-id-indexes).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_by_trace_id_index
(
  TenantId String,
  TraceId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  RetainAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, TraceId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(RetainAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_by_trace_id_index_mv
TO ${CLICKHOUSE_DATABASE}.evaluation_runs_by_trace_id_index AS
SELECT TenantId, assumeNotNull(TraceId) AS TraceId,
  min(ScheduledAt) AS FromAt, max(ScheduledAt) AS ToAt,
  max(UpdatedAt) AS RetainAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.evaluation_runs
WHERE TraceId IS NOT NULL AND TraceId != ''
GROUP BY TenantId, TraceId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.
-- To roll back, uncomment and run manually (the view first, then its table):
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_by_trace_id_index_mv;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_runs_by_trace_id_index;
