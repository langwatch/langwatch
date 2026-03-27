-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    ADD COLUMN IF NOT EXISTS Metadata Nullable(String) CODEC(ZSTD(3)) AFTER Description;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
--   DROP COLUMN IF EXISTS Metadata;

-- +goose StatementEnd
-- +goose ENVSUB OFF
