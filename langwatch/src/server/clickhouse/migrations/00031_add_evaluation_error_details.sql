-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
    ADD COLUMN IF NOT EXISTS ErrorDetails Nullable(String) AFTER Error;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
--    DROP COLUMN IF EXISTS ErrorDetails;
-- +goose StatementEnd
-- +goose ENVSUB OFF
