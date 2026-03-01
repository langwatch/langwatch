-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    ADD COLUMN IF NOT EXISTS StartedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1)) AFTER DurationMs;

-- +goose StatementEnd
-- +goose StatementBegin

-- Backfill: set StartedAt = CreatedAt for existing rows
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    UPDATE StartedAt = CreatedAt WHERE StartedAt IS NULL;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    DROP COLUMN IF EXISTS StartedAt;

-- +goose StatementEnd
-- +goose ENVSUB OFF
