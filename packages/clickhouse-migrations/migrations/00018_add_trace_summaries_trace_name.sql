-- +goose Up
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS TraceName String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_trace_name TraceName TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_trace_name;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP INDEX IF EXISTS idx_trace_name;
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS TraceName;
