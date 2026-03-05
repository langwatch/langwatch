-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS DeletedAt Nullable(DateTime64(3)) DEFAULT NULL CODEC(Delta(8), ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  DROP COLUMN IF EXISTS DeletedAt;

-- +goose StatementEnd
-- +goose ENVSUB OFF
