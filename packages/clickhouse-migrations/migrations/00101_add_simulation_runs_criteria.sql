-- +goose Up
-- +goose ENVSUB ON

-- Per-criterion judge verdicts on scenario runs.
--
-- One entry per criterion as parallel `Criteria.*` arrays, in the order the
-- scenario declared them: the criterion, the judge's restatement of it as a
-- positive requirement, its status (passed, failed or inconclusive) and the
-- judge's reasoning for it. Written by the simulation run fold from the
-- finished event. SDKs from before per-criterion verdicts send none; the
-- read path derives the entries from MetCriteria, UnmetCriteria and
-- InconclusiveCriteria for those runs.
--
-- Not added to _size_bytes, like InconclusiveCriteria (00100): changing the
-- MATERIALIZED expression restates its type, which the migration scanner
-- refuses. The reasoning is a few hundred bytes per criterion.
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
  ADD COLUMN IF NOT EXISTS `Criteria.Criterion` Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Criteria.Requirement` Array(String) DEFAULT [] CODEC(ZSTD(3))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Criteria.Status` Array(LowCardinality(String)) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `Criteria.Reasoning` Array(String) DEFAULT [] CODEC(ZSTD(3))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Criteria.Criterion`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Criteria.Requirement`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Criteria.Status`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `Criteria.Reasoning`;
-- +goose StatementEnd
