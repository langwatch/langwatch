-- +goose Up
-- +goose ENVSUB ON

-- Root span type. The root span's *name* is captured by TraceName from
-- 00018_add_trace_summaries_trace_name; this migration only adds the
-- type plus the AI-containment flag.
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS RootSpanType LowCardinality(Nullable(String)) CODEC(ZSTD(1));
-- +goose StatementEnd

-- AI containment flag
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS ContainsAi Bool DEFAULT 0;
-- +goose StatementEnd

-- Index for efficient filtering
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_contains_ai ContainsAi TYPE set(2) GRANULARITY 4;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_contains_ai;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS ContainsAi;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS RootSpanType;
-- +goose StatementEnd

-- +goose ENVSUB OFF
