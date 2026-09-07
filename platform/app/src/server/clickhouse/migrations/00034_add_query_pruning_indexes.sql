-- +goose Up
-- +goose ENVSUB ON

-- Adds skipping indexes for granule-level pruning the existing schemas missed:
--
--   1. trace_summaries.idx_occurred_at — analytics queries filter heavily on
--      OccurredAt (PARTITION BY toYearWeek(OccurredAt) gives week-granularity
--      pruning; this minmax lets the planner skip granules within a partition).
--      MATERIALIZE is run inline because trace_summaries is small enough that
--      backfilling the index across cold parts is cheap, and the historic
--      analytics queries this index helps need it for the existing data.
--
--   2. stored_log_records / stored_metric_records — ResourceAttributes bloom
--      filters for parity with stored_spans. Map filters like
--      ResourceAttributes['service.name'] = 'x' currently scan the whole map
--      column because nothing indexes the keys/values; this matches the
--      idx_res_attr_key / idx_res_attr_value pair on stored_spans.
--
--      Crucially: NO MATERIALIZE for these two. They're high-volume tables
--      with cold-tier S3 parts whose volume we haven't measured. Materializing
--      would stream them back through compute and queue minutes-to-hours of
--      merge backlog. The bloom filter is a go-forward optimisation; new
--      parts pick it up immediately. Historic ResourceAttributes lookups on
--      log/metric records are rare (heavy queries hit stored_spans, which
--      already has the equivalent indexes). If a future workload genuinely
--      needs the historic backfill, MATERIALIZE INDEX can be run via a
--      follow-up migration once cold-part volume is measured and a runbook
--      for monitoring `system.mutations` is in place.

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
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 4;
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
