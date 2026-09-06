-- +goose Up
-- +goose ENVSUB ON

-- Evaluator results on scenario runs.
--
-- One entry per evaluator that ran on the scenario, as parallel `Evaluations.*`
-- arrays, the same shape `Messages.*` takes. Written by the simulation run
-- fold from the finished event (a run from code sends them itself) or from
-- the evaluated event (the platform ran them after the run finished). Every
-- version of a run row carries the full list, so the ReplacingMergeTree keeps
-- them through merges the way it keeps every other column.
--
-- Every Array column added by ALTER carries a DEFAULT, see 00057: without one
-- a part written before this migration reads the absent column's size header
-- as garbage.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.EvaluatorId` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Name` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Status` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Required` Array(UInt8) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Passed` Array(Nullable(UInt8)) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Score` Array(Nullable(Float64)) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Label` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.Details` Array(String) DEFAULT [] CODEC(ZSTD(3))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.CostAmount` Array(Nullable(Float64)) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.CostCurrency` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Evaluations.InputsJson` Array(String) DEFAULT [] CODEC(ZSTD(3))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- The stored size of a row (00032) counts the new columns too: details and
-- resolved inputs are prose, and a run with several evaluators carries a
-- few kilobytes of them. Changing a MATERIALIZED expression is metadata
-- only; parts written before this read their stored value.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  MODIFY COLUMN `_size_bytes` UInt32
    MATERIALIZED byteSize(
      Status, Name, Description,
      `Messages.Id`, `Messages.Role`, `Messages.Content`,
      `Messages.TraceId`, `Messages.Rest`,
      TraceIds, Verdict, Reasoning,
      MetCriteria, UnmetCriteria,
      Error, Metadata,
      RoleCosts, RoleLatencies,
      TraceMetricsJson,
      `Evaluations.EvaluatorId`, `Evaluations.Name`, `Evaluations.Status`,
      `Evaluations.Label`, `Evaluations.Details`, `Evaluations.InputsJson`
    )
    CODEC(Delta(4), ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually. The _size_bytes expression must
-- be restored to its pre-migration form first: it still references the
-- Evaluations.* columns below, and dropping a column it reads would fail.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
--   MODIFY COLUMN `_size_bytes` UInt32
--     MATERIALIZED byteSize(
--       Status, Name, Description,
--       `Messages.Id`, `Messages.Role`, `Messages.Content`,
--       `Messages.TraceId`, `Messages.Rest`,
--       TraceIds, Verdict, Reasoning,
--       MetCriteria, UnmetCriteria,
--       Error, Metadata,
--       RoleCosts, RoleLatencies,
--       TraceMetricsJson
--     )
--     CODEC(Delta(4), ZSTD(1))
--   SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.EvaluatorId`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Name`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Status`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Required`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Passed`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Score`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Label`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.Details`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.CostAmount`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.CostCurrency`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Evaluations.InputsJson`;
-- +goose StatementEnd

-- +goose ENVSUB OFF
