-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS OutputFromRootSpan Bool DEFAULT 0,
  ADD COLUMN IF NOT EXISTS OutputSpanEndTimeMs Int64 DEFAULT 0;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP COLUMN IF EXISTS OutputFromRootSpan,
  DROP COLUMN IF EXISTS OutputSpanEndTimeMs;
-- +goose StatementEnd
-- +goose ENVSUB OFF
