-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

-- Track the highest occurredAt seen across all events for each aggregate.
-- Used by the fold projection executor to detect out-of-order events and
-- trigger a re-fold from scratch in occurredAt order.

ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));

ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));

ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs
  ADD COLUMN IF NOT EXISTS LastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));

ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  ADD COLUMN IF NOT EXISTS lastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS lastEventOccurredAt DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta(8), ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.simulation_runs DROP COLUMN IF EXISTS LastEventOccurredAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.experiment_runs DROP COLUMN IF EXISTS LastEventOccurredAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.suite_runs DROP COLUMN IF EXISTS LastEventOccurredAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs DROP COLUMN IF EXISTS lastEventOccurredAt;
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries DROP COLUMN IF EXISTS lastEventOccurredAt;
