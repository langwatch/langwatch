-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS LastProcessedEventId;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_states DROP COLUMN IF EXISTS LastProcessedEventId;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS LastProcessedEventId;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs ADD COLUMN IF NOT EXISTS LastProcessedEventId String CODEC(ZSTD(1)) AFTER StoppedAt;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_states ADD COLUMN IF NOT EXISTS LastProcessedEventId String CODEC(ZSTD(1)) AFTER CompletedAt;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs ADD COLUMN IF NOT EXISTS LastProcessedEventId String CODEC(ZSTD(1)) AFTER FinishedAt;
-- +goose StatementEnd
-- +goose ENVSUB OFF
