-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- Add ErrorDetails column to evaluation_runs for storing extended error context (e.g. stack traces)
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS ErrorDetails Nullable(String) AFTER Error;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE evaluation_runs DROP COLUMN IF EXISTS ErrorDetails;

-- +goose StatementEnd
-- +goose ENVSUB OFF

