-- +goose Up
-- +goose ENVSUB ON

-- Add _retention_days (UInt16, 0 = indefinite) and _size_bytes (UInt32) to
-- all 11 retention-managed tables. Each ALTER is its own StatementBegin block
-- because ClickHouse does not support multi-statement ALTER queries.

-- event_log: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- event_log: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- stored_spans: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- stored_spans: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_spans
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- stored_log_records: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- stored_log_records: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_log_records
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- stored_metric_records: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- stored_metric_records: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.stored_metric_records
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- trace_summaries: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- trace_summaries: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- evaluation_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- evaluation_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- experiment_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- experiment_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- experiment_run_items: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- experiment_run_items: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_run_items
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- simulation_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- simulation_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- suite_runs: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- suite_runs: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- dspy_steps: _retention_days
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps
  ADD COLUMN IF NOT EXISTS `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1));
-- +goose StatementEnd

-- dspy_steps: _size_bytes
-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.dspy_steps
  ADD COLUMN IF NOT EXISTS `_size_bytes` UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1));
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- To roll back, uncomment and run manually:
-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log DROP COLUMN IF EXISTS `_retention_days`;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.event_log DROP COLUMN IF EXISTS `_size_bytes`;
-- ... (repeat for all 11 tables)
-- +goose StatementEnd
