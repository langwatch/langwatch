-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
RENAME TABLE ${CLICKHOUSE_DATABASE}.batch_evaluation_runs TO ${CLICKHOUSE_DATABASE}.experiment_runs;
-- +goose StatementEnd
-- +goose StatementBegin
RENAME TABLE ${CLICKHOUSE_DATABASE}.batch_evaluation_results TO ${CLICKHOUSE_DATABASE}.experiment_run_items;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
RENAME TABLE ${CLICKHOUSE_DATABASE}.experiment_runs TO ${CLICKHOUSE_DATABASE}.batch_evaluation_runs;
-- +goose StatementEnd
-- +goose StatementBegin
RENAME TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items TO ${CLICKHOUSE_DATABASE}.batch_evaluation_results;
-- +goose StatementEnd
-- +goose ENVSUB OFF
