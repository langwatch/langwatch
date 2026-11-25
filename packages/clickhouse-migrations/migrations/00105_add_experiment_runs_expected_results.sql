-- +goose Up
-- +goose ENVSUB ON

-- How many rows and verdicts a run reported in total, as its reporter counted
-- them. Results are stored after they are reported, so a read compares what is
-- stored against these to tell a run still being stored from a whole one.
-- NULL when the reporter sent no counts.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS ExpectedTargetResults Nullable(UInt32) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS ExpectedEvaluatorResults Nullable(UInt32) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS ExpectedTargetResults;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS ExpectedEvaluatorResults;
-- +goose StatementEnd
