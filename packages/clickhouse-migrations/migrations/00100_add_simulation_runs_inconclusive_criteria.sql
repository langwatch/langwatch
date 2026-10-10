-- +goose Up
-- +goose ENVSUB ON

-- Criteria the judge could not decide on a scenario run.
--
-- The judge answers each criterion true, false or inconclusive. An
-- inconclusive criterion stays in UnmetCriteria (a run never passes on a
-- criterion nobody could verify) and is listed here as well, so the run
-- detail and the export can tell "the agent did not do it" from "the
-- evidence never arrived". Written by the simulation run fold from the
-- finished event.
--
-- Not added to _size_bytes: every entry here is already counted through
-- UnmetCriteria.
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
  ADD COLUMN IF NOT EXISTS InconclusiveCriteria Array(String) DEFAULT [] CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS InconclusiveCriteria;
-- +goose StatementEnd
