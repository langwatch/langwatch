-- +goose Up
-- +goose ENVSUB ON

-- Adds skipping indexes for granule-level pruning the existing schemas missed:
--
--   1. trace_summaries.idx_occurred_at — analytics queries filter heavily on
--      OccurredAt (PARTITION BY toYearWeek(OccurredAt) gives week-granularity
--      pruning; this minmax lets the planner skip granules within a partition).
--
--   2. stored_log_records / stored_metric_records — ResourceAttributes bloom
--      filters for parity with stored_spans. Map filters like
--      ResourceAttributes['service.name'] = 'x' currently scan the whole map
--      column because nothing indexes the keys/values; this matches the
--      idx_res_attr_key / idx_res_attr_value pair on stored_spans.
--
-- MATERIALIZE INDEX is a background mutation. On warm parts it's quick; on
-- cold-tier S3 parts the mutation will stream them back through compute. Safe
-- to run in production but expect minutes-to-hours of merge backlog on
-- high-volume tables before the index is fully effective for historic data.
-- New parts use the index immediately.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD INDEX IF NOT EXISTS idx_occurred_at OccurredAt TYPE minmax GRANULARITY 1;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  MATERIALIZE INDEX idx_occurred_at;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  MATERIALIZE INDEX idx_res_attr_key;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  MATERIALIZE INDEX idx_res_attr_value;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  MATERIALIZE INDEX idx_res_attr_key;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  MATERIALIZE INDEX idx_res_attr_value;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are intentionally commented out per project convention
-- (see dev/docs/best_practices/clickhouse-queries.md and prior migrations).
-- To roll back, uncomment and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP INDEX IF EXISTS idx_occurred_at;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records DROP INDEX IF EXISTS idx_res_attr_key;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records DROP INDEX IF EXISTS idx_res_attr_value;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records DROP INDEX IF EXISTS idx_res_attr_key;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records DROP INDEX IF EXISTS idx_res_attr_value;
-- +goose StatementEnd

-- +goose ENVSUB OFF
