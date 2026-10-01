-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- The trace-level events list is no longer accumulated on the trace_summaries
-- fold (the per-span hoist grew the fold state O(span-count) and made folding
-- O(n^2)). It is now derived from stored_spans at read time, so these columns
-- are dead and dropped.
ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  DROP COLUMN IF EXISTS `Events.SpanId`,
  DROP COLUMN IF EXISTS `Events.Timestamp`,
  DROP COLUMN IF EXISTS `Events.Name`,
  DROP COLUMN IF EXISTS `Events.Attributes`;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- To roll back, uncomment and run manually. Re-adds the columns empty; the
-- historical values are not recoverable (they are re-derivable from stored_spans).
-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   ADD COLUMN IF NOT EXISTS `Events.SpanId` Array(String) CODEC(ZSTD(1)),
--   ADD COLUMN IF NOT EXISTS `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1)),
--   ADD COLUMN IF NOT EXISTS `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
--   ADD COLUMN IF NOT EXISTS `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF
