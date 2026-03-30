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

ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
    MODIFY COLUMN AvgScoreBps Nullable(UInt32);

-- +goose StatementEnd
-- +goose ENVSUB OFF
