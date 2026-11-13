-- +goose Up
-- +goose ENVSUB ON

-- Repair for the 00125 clash (2026-11-11): two migrations shipped as 00125.
-- A database that ran 00125_trace_analytics_metadata_columns (now 00126)
-- counts 00125 as applied and never runs 00125_add_experiment_runs_concurrency.
-- This re-adds that column; IF NOT EXISTS makes it a no-op everywhere else.

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
