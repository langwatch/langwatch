-- +goose Up
-- +goose ENVSUB ON

-- How many cells a run kept in flight at once, as its plan fixed it when the
-- run started: the run's own concurrency, the experiment's saved setting or the
-- server default. NULL for a run started without a plan.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS Concurrency Nullable(UInt16) DEFAULT NULL
  SETTINGS alter_sync = 1, mutations_sync = 0;
-- +goose StatementEnd

-- +goose Down
-- To roll back, uncomment and run manually.

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS Concurrency;
-- +goose StatementEnd
