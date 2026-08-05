-- +goose Up
-- +goose ENVSUB ON

-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
    ADD COLUMN IF NOT EXISTS CancellationRequestedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1));

-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
--     DROP COLUMN IF EXISTS CancellationRequestedAt;
