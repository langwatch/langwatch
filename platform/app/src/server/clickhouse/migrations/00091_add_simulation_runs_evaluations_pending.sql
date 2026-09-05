-- +goose Up
-- +goose ENVSUB ON

-- Whether a finished scenario run still owes evaluator results.
--
-- Written by the simulation run fold: set when the run finishes carrying
-- evaluator attachments and no results of its own, cleared when the evaluated
-- event records them. A reader turns it into the PENDING_EVALUATION status
-- while the run finished recently enough, so nothing reports a green run that
-- a required evaluator is about to fail.
--
-- Cluster note: no ON CLUSTER. When CLICKHOUSE_CLUSTER is set the database
-- uses the Replicated engine (00001), which propagates DDL to every node on
-- its own.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `EvaluationsPending` UInt8 DEFAULT 0 CODEC(ZSTD(1))
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS `EvaluationsPending`;
-- +goose StatementEnd

-- +goose ENVSUB OFF
