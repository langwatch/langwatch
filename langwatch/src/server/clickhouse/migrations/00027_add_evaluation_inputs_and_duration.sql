-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS EvaluationInputs Nullable(String) CODEC(ZSTD(3)),
  ADD COLUMN IF NOT EXISTS EvaluationDurationMs Nullable(UInt32);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
--   DROP COLUMN IF EXISTS EvaluationInputs,
--   DROP COLUMN IF EXISTS EvaluationDurationMs;
-- +goose StatementEnd
-- +goose ENVSUB OFF
