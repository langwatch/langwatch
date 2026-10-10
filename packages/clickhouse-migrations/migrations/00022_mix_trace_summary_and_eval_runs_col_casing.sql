-- +goose Up
-- +goose ENVSUB ON

-- Migration 00015 added `LastEventOccurredAt` to simulation_runs / experiment_runs
-- / suite_runs (PascalCase, matching every other column on those tables) but
-- accidentally added the same column as `lastEventOccurredAt` (camelCase) on
-- evaluation_runs and trace_summaries. The mismatch made readers/writers in
-- the app silently miss the field — JSONEachRow reads of `LastEventOccurredAt`
-- returned undefined, falling back through `?? 0` and breaking out-of-order
-- event detection in foldProjectionExecutor.
--
-- Rename both columns to the canonical PascalCase. RENAME COLUMN on a
-- ReplacingMergeTree is metadata-only — no rewrite of existing parts.

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
  RENAME COLUMN IF EXISTS lastEventOccurredAt TO LastEventOccurredAt;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  RENAME COLUMN IF EXISTS lastEventOccurredAt TO LastEventOccurredAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment the RENAME statements and run manually.
-- +goose ENVSUB ON

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.evaluation_runs
--   RENAME COLUMN IF EXISTS LastEventOccurredAt TO lastEventOccurredAt;
-- +goose StatementEnd

-- +goose StatementBegin
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   RENAME COLUMN IF EXISTS LastEventOccurredAt TO lastEventOccurredAt;
-- +goose StatementEnd

-- +goose ENVSUB OFF
