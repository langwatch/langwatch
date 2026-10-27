-- +goose Up
-- +goose ENVSUB ON

-- Trace-level prompt rollup, projected at ingest from span attributes.
-- Each *Id pair stores the source SpanId so the drawer can deep-link from
-- a facet hit straight to the span the value was derived from.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS ContainsPrompt Bool DEFAULT 0;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SelectedPromptId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS SelectedPromptSpanId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS LastUsedPromptId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS LastUsedPromptVersionNumber Nullable(UInt32);
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS LastUsedPromptVersionId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS LastUsedPromptSpanId Nullable(String) CODEC(ZSTD(1));
-- +goose StatementEnd

-- Indexes for filter performance
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_contains_prompt ContainsPrompt TYPE set(2) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_selected_prompt SelectedPromptId TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_last_used_prompt LastUsedPromptId TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_last_used_prompt_version LastUsedPromptVersionNumber TYPE minmax GRANULARITY 4;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_last_used_prompt_version;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_last_used_prompt;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_selected_prompt;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_contains_prompt;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LastUsedPromptSpanId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LastUsedPromptVersionId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LastUsedPromptVersionNumber;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS LastUsedPromptId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS SelectedPromptSpanId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS SelectedPromptId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS ContainsPrompt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
