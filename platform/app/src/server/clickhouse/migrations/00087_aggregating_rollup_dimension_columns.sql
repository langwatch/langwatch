-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Give every AggregatingMergeTree rollup an explicit merge rule for the
-- columns that are not part of its sorting key.
--
-- An AggregatingMergeTree collapses rows that share a sorting key on merge.
-- A column that is neither in the sorting key nor an aggregate state has no
-- merge rule, so the surviving row keeps the value of whichever input row the
-- merge happened to read last. Four columns were in that position:
--
--   gateway_budget_scope_totals.UpdatedAt       — write time of the row
--   trace_analytics_rollup._retention_days      — TTL horizon in days
--   evaluation_analytics_rollup._retention_days — TTL horizon in days
--   simulation_run_metrics_rollup.PartitionMonth — partition anchor
--
-- SimpleAggregateFunction(max, T) states the rule the readers already assume:
-- the newest write time, and the longest retention the project asked for.
-- PartitionMonth is constant inside a partition, so max() returns the value
-- it already held. Storage is unchanged (a SimpleAggregateFunction column is
-- stored as its underlying type), so each ALTER is metadata-only and no part
-- is rewritten.
--
-- ClickHouse 26.0 turned this schema into a create-time error (BAD_ARGUMENTS,
-- "Column(s) X of the AggregatingMergeTree table are neither part of the
-- sorting key nor aggregate measures"). The statements that create these
-- tables are merged history (00017/00038/00040/00058/00064/00065/00066/00069
-- and 00081) and cannot be edited, so a new install replays them exactly as
-- they are. runMigrations in goose.ts therefore runs everything up to 00086
-- with allow_dimensions_outside_sorting_key relaxed, but only on a server
-- that has that setting, and this migration converts the tables immediately
-- after. Both paths end here, so an install created on ClickHouse 25 and one
-- created on ClickHouse 26 carry the same schema.
--
-- Migrations after this one run with the check in force.
--
-- A table created during that relaxed phase keeps the setting in its own
-- SETTINGS clause. It is left there: it cannot be reset by a statement that
-- also has to run on ClickHouse 25, where the setting does not exist, and it
-- relaxes a check that has nothing left to relax once the ALTERs below have
-- run. The columns are what the guards assert on, not the setting.
--
-- SETTINGS alter_sync = 1, mutations_sync = 0 — wait for the local replica
-- only, never queue behind unrelated mutations (same as 00032).
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
  MODIFY COLUMN UpdatedAt SimpleAggregateFunction(max, DateTime64(3))
    DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics_rollup
  MODIFY COLUMN `_retention_days` SimpleAggregateFunction(max, UInt16)
    DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup
  MODIFY COLUMN `_retention_days` SimpleAggregateFunction(max, UInt16)
    DEFAULT 308 CODEC(Delta(2), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup
  MODIFY COLUMN PartitionMonth SimpleAggregateFunction(max, UInt32)
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. The reverse ALTER drops the merge
-- rule and restores the plain column type, which ClickHouse 26 and newer
-- reject at CREATE TABLE time.
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
--   MODIFY COLUMN UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_analytics_rollup
--   MODIFY COLUMN `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_analytics_rollup
--   MODIFY COLUMN `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1));
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_run_metrics_rollup
--   MODIFY COLUMN PartitionMonth UInt32;
