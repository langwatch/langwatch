-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SatisfactionScore Nullable(Float64),
  ADD COLUMN IF NOT EXISTS BlockedByGuardrail Bool DEFAULT 0;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--  DROP COLUMN IF EXISTS SatisfactionScore,
--  DROP COLUMN IF EXISTS BlockedByGuardrail;
-- +goose StatementEnd
-- +goose ENVSUB OFF
