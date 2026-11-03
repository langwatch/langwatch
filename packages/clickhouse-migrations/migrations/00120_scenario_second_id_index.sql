-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Scenario's second-key id indexes (dev/docs/plans/id-index-2026-10-10.md): the
-- runs of one batch and the runs of one scenario set, so a read by BatchRunId
-- or by ScenarioSetId alone reads only the partitions they live in.
-- simulation_runs is ordered by (TenantId, ScenarioRunId), so the first index
-- cannot serve either. Shaped as 00115: per (TenantId, key) the earliest and
-- latest StartedAt and the longest retention; unpartitioned, on the data disk, no TTL move to cold,
-- expiring seven days after the latest row each points at. A view fills each
-- inside every insert; older rows come from the owner's background step
-- (scenario:fill-id-indexes).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_batch_run_id_index
(
  TenantId String,
  BatchRunId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, BatchRunId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_batch_run_id_index_mv
TO ${CLICKHOUSE_DATABASE}.simulation_runs_by_batch_run_id_index AS
SELECT TenantId, BatchRunId,
  min(StartedAt) AS FromAt, max(StartedAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.simulation_runs
GROUP BY TenantId, BatchRunId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_scenario_set_id_index
(
  TenantId String,
  ScenarioSetId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, ScenarioSetId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(ToAt) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_scenario_set_id_index_mv
TO ${CLICKHOUSE_DATABASE}.simulation_runs_by_scenario_set_id_index AS
SELECT TenantId, ScenarioSetId,
  min(StartedAt) AS FromAt, max(StartedAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.simulation_runs
GROUP BY TenantId, ScenarioSetId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the indexes.

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The indexes are rebuildable
-- by the owner's background step.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_batch_run_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_batch_run_id_index;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_scenario_set_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.simulation_runs_by_scenario_set_id_index;
-- +goose StatementEnd
