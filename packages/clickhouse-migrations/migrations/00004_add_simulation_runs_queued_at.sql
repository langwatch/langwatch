-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    ADD COLUMN IF NOT EXISTS QueuedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)) AFTER StartedAt;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
--   DROP COLUMN IF EXISTS QueuedAt;

-- +goose StatementEnd
-- +goose ENVSUB OFF
