-- +goose Up
-- +goose ENVSUB ON

-- Pin state, projected onto the trace summary (replacing the legacy PinnedTrace
-- Postgres table). PinnedSource is '' when the trace is not pinned, else
-- 'manual' (user pin) or 'share' (auto-pin created on share). The facet
-- registry derives the categorical value via if(PinnedSource != '', ...).
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS PinnedSource LowCardinality(String) DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS PinnedReason String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS PinnedByUserId String DEFAULT '' CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS PinnedAt Nullable(DateTime64(3)) CODEC(ZSTD(1));
-- +goose StatementEnd

-- Skipping index so the "pinned" facet + list filter prune granules instead of
-- scanning every row; the set is tiny (three distinct values).
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_pinned_source PinnedSource TYPE set(3) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_pinned_source;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_pinned_source;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS PinnedAt;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS PinnedByUserId;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS PinnedReason;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS PinnedSource;
-- +goose StatementEnd

-- +goose ENVSUB OFF
