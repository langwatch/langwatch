-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Experiment's second id index (dev/docs/plans/id-index-2026-10-10.md): the
-- runs of one experiment, so a read by ExperimentId alone reads only the
-- partitions its runs live in. experiment_runs is ordered by (TenantId, RunId,
-- ExperimentId), so the first index cannot serve it. Shaped as 00114: per
-- (TenantId, ExperimentId) the earliest and latest StartedAt and the longest
-- retention; unpartitioned, on the data disk, no TTL move to cold, expiring seven days after the
-- latest row it points at. A view fills it inside every insert; older rows come
-- from the owner's background step (experiment:fill-id-indexes).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_by_experiment_id_index
(
  TenantId String,
  ExperimentId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, ExperimentId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_by_experiment_id_index_mv
TO ${CLICKHOUSE_DATABASE}.experiment_runs_by_experiment_id_index AS
SELECT TenantId, ExperimentId,
  min(StartedAt) AS FromAt, max(StartedAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.experiment_runs
GROUP BY TenantId, ExperimentId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The index is rebuildable
-- by the owner's background step.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_by_experiment_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.experiment_runs_by_experiment_id_index;
-- +goose StatementEnd
