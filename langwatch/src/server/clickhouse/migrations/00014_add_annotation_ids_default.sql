-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- Fix: AnnotationIds was added without DEFAULT, causing unmaterialized column
-- data in old parts. During merges the corrupted size header can trigger
-- "Amount of memory requested to allocate is more than allowed" OOM errors.
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN AnnotationIds Array(String) DEFAULT [] CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MODIFY COLUMN AnnotationIds Array(String) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF
