-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
    ADD COLUMN IF NOT EXISTS CostId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
    DROP COLUMN IF EXISTS CostId;
-- +goose StatementEnd
-- +goose ENVSUB OFF
