-- +goose Up
-- +goose ENVSUB ON

-- Add OccurredAt column (event time) - defaults to CreatedAt for existing data
-- CreatedAt can't be renamed because it's used in PARTITION BY
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
    ADD COLUMN IF NOT EXISTS OccurredAt DateTime64(3) DEFAULT CreatedAt CODEC(Delta(8), ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
    DROP COLUMN IF EXISTS OccurredAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
