-- +goose Up
-- +goose ENVSUB ON

-- Archival is written via the trace-processing fold projection on
-- TraceArchivedEvent, which upserts into trace_summaries. stored_spans
-- is an append-only map projection and cannot be updated post-hoc;
-- span-scoped reads exclude archived traces via a trace_summaries
-- subquery filter at query time.

-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
    ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3)) CODEC(ZSTD(1));

-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--     DROP COLUMN IF EXISTS ArchivedAt;
