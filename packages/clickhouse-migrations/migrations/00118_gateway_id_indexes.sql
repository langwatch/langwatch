-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Gateway's id indexes (dev/docs/plans/id-index-2026-10-10.md): per
-- (TenantId, GatewayRequestId), the earliest and latest source time, so a
-- lookup by request id alone reads only the partitions the request lives in.
-- Neither source carries _retention_days, so the column is the "forever"
-- sentinel 65535. gateway_spend keeps a fixed 13 months (00067) and its index
-- expires seven days after that, except the fill marker (TenantId ''), which
-- carries no time and must outlive every expiry merge; the ledger has no TTL and neither has its
-- index, which makes "seen" exact for the idempotency probes. A view fills each
-- inside every insert; older rows come from the owner's background step
-- (gateway:fill-id-indexes).
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_id_index
(
  TenantId String,
  GatewayRequestId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, GatewayRequestId)
TTL IF(TenantId = '', toDateTime('2106-01-01'), toDateTime(ToAt) + INTERVAL 13 MONTH + INTERVAL 7 DAY) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_id_index_mv
TO ${CLICKHOUSE_DATABASE}.gateway_spend_id_index AS
SELECT TenantId, GatewayRequestId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(toUInt16(65535)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.gateway_spend
GROUP BY TenantId, GatewayRequestId;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index
(
  TenantId String,
  GatewayRequestId String,
  FromAt SimpleAggregateFunction(min, DateTime64(3)),
  ToAt SimpleAggregateFunction(max, DateTime64(3)),
  _retention_days SimpleAggregateFunction(max, UInt16)
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
ORDER BY (TenantId, GatewayRequestId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index_mv
TO ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index AS
SELECT TenantId, GatewayRequestId,
  min(OccurredAt) AS FromAt, max(OccurredAt) AS ToAt,
  max(toUInt16(65535)) AS _retention_days
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
GROUP BY TenantId, GatewayRequestId;
-- +goose StatementEnd

-- +goose Down

-- IRREVERSIBLE: down is manual by house rule; the owner's fill step rebuilds the index.

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The indexes are rebuildable
-- by the owner's background step.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_id_index;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events_id_index;
-- +goose StatementEnd
