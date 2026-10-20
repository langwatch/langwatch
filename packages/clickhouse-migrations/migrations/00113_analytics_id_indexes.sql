-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Analytics' id index (dev/docs/plans/id-index-2026-10-10.md §1): for
-- evaluation_analytics, an unpartitioned AggregatingMergeTree mapping
-- (TenantId, EvaluationId) to the OccurredAt range the evaluation's rows live
-- in, filled by a view inside every insert. A lookup by evaluation id reads the
-- index first and bounds its source read, inner dedup subquery included, to
-- that range.
--
-- FromAt/ToAt keep the source's DateTime64(3), so nothing converts. Retention is
-- copied with "keep forever" (0) written as 65535, so `max` keeps it sticky; the
-- index expires 7 days after its source rows and has no TTL move to cold (absent
-- from TABLE_TTL_CONFIG); it sits on the data disk (local_primary) like its
-- source. Retention changes reach it raise-only through RETENTION_ID_INDEX_TABLES.
--
-- Rows older than the view are filled by the background step
-- `analytics:fill-id-indexes`, which then writes the index's ready marker
-- row. The view fills only new inserts: a new table
-- and view, no mutation, no rewrite at deploy.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_id_index
(
  TenantId String,
  EvaluationId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, EvaluationId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_id_index_mv
TO ${CLICKHOUSE_DATABASE}.evaluation_analytics_id_index AS
SELECT TenantId, EvaluationId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.evaluation_analytics
GROUP BY TenantId, EvaluationId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.
-- To roll back, uncomment and run manually (the view first, then its table):
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_id_index_mv;
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.evaluation_analytics_id_index;
