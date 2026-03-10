-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ErrorDetails was added to the 00002 schema migration after it had already
-- been applied to existing deployments. This migration adds it retroactively.
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
    ADD COLUMN IF NOT EXISTS ErrorDetails Nullable(String) CODEC(ZSTD(3)) AFTER Error;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
--   DROP COLUMN IF EXISTS ErrorDetails;

-- +goose StatementEnd
-- +goose ENVSUB OFF
