-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
    MODIFY COLUMN AvgScoreBps Nullable(Int32);

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- Unsafe rollback: negative AvgScoreBps values written after this migration
-- would wrap/corrupt if the column is changed back to UInt32.
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
--   MODIFY COLUMN AvgScoreBps Nullable(UInt32);

-- +goose StatementEnd
-- +goose ENVSUB OFF
