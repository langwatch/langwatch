-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `Events.SpanId` Array(String) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `Events.Timestamp` Array(DateTime64(3)) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose StatementBegin

ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
  ADD COLUMN IF NOT EXISTS `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1));

-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS `Events.Attributes`;

-- +goose StatementEnd
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS `Events.Name`;

-- +goose StatementEnd
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS `Events.Timestamp`;

-- +goose StatementEnd
-- +goose StatementBegin

-- ALTER TABLE ${CLICKHOUSE_DATABASE}.trace_summaries
--   DROP COLUMN IF EXISTS `Events.SpanId`;

-- +goose StatementEnd
-- +goose ENVSUB OFF
