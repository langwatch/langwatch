-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS AnnotationIds Array(String) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_annotation_ids AnnotationIds TYPE bloom_filter(0.01) GRANULARITY 4;

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP INDEX IF EXISTS idx_annotation_ids;

-- +goose StatementEnd
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS AnnotationIds;

-- +goose StatementEnd
-- +goose ENVSUB OFF
