-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Eventing's aggregate index (dev/docs/plans/id-index-2026-10-10.md): per
-- (TenantId, AggregateType, AggregateId), the earliest and latest EventOccurredAt
-- in epoch ms and the longest retention, so a fold or a replay reads only the
-- weeks an aggregate's events span. Rows with no occurred time (0) stay out:
-- every bounded read keeps them through its `EventOccurredAt = 0` arm.
-- Unpartitioned and never tiered cold; an index row expires seven days after
-- the latest event it points at, the time clamped because producers supply it.
-- A view fills it inside every insert; rows older than the view come from the
-- background step ops:fill-event-log-id-index.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.event_log_id_index
(
  TenantId String,
  AggregateType LowCardinality(String),
  AggregateId String,
  FromAt SimpleAggregateFunction(min, UInt64),
  ToAt SimpleAggregateFunction(max, UInt64),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, AggregateType, AggregateId)
TTL IF(_retention_days BETWEEN 1 AND 65534, toDateTime(least(intDiv(ToAt, 1000), 4294967295)) + toIntervalDay(_retention_days + 7), toDateTime('2106-01-01')) DELETE;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.event_log_id_index_mv
TO ${CLICKHOUSE_DATABASE}.event_log_id_index AS
SELECT TenantId, AggregateType, AggregateId,
  min(EventOccurredAt) AS FromAt, max(EventOccurredAt) AS ToAt,
  max(if(_retention_days = 0, 65535, _retention_days)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.event_log
WHERE EventOccurredAt > 0
GROUP BY TenantId, AggregateType, AggregateId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The index is rebuildable by
-- ops:fill-event-log-id-index.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.event_log_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.event_log_id_index;
-- +goose StatementEnd
