-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
    ADD COLUMN IF NOT EXISTS Inputs Nullable(String) CODEC(ZSTD(3)) AFTER Details;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
--   DROP COLUMN IF EXISTS Inputs;

-- +goose StatementEnd
-- +goose ENVSUB OFF
