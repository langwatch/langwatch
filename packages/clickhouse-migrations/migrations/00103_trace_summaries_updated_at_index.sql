-- +goose Up
-- +goose ENVSUB ON

-- minmax skip index on UpdatedAt: the table is partitioned by OccurredAt, so a read on the
-- updated axis (governance trace facts, every minute) otherwise scans the tenant's whole history.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_updated_at UpdatedAt TYPE minmax GRANULARITY 1;
-- +goose StatementEnd

-- Materialize the index for existing data (runs as background mutation, partition-by-partition)
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_updated_at;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP INDEX IF EXISTS idx_updated_at;
-- +goose StatementEnd

-- +goose ENVSUB OFF
