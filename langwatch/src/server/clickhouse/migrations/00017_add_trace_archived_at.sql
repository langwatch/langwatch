-- +goose Up
-- +goose ENVSUB ON

-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
    ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1));

-- +goose StatementEnd

-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
    ADD COLUMN IF NOT EXISTS ArchivedAt Nullable(DateTime64(3)) CODEC(Delta(8), ZSTD(1));

-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--     DROP COLUMN IF EXISTS ArchivedAt;
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
--     DROP COLUMN IF EXISTS ArchivedAt;
