-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Webhook delivered-event markers — the first-sight ledger for the webhook
-- delivery process manager.
--
-- One row per (tenant, gateway request id) the moment its spend event is
-- enqueued for webhook delivery. The delivery scan anti-joins this table so
-- a ReplacingMergeTree re-fold of an already-enqueued request (new
-- EventTimestamp version, same GatewayRequestId) is never re-emitted as a
-- fresh `gateway.request.completed` envelope: completed events fire on
-- FIRST sight only, restatements are the future `gateway.request.adjusted`
-- family.
--
-- Duplicate marker rows are harmless (the anti-join only asks "seen at
-- all?"), so this is a plain MergeTree, no replacement machinery. Retention
-- runs one month past the spend table's 13 months so the anti-join never
-- resurrects a request whose marker expired first.
--
-- Retention: EXEMPT from tenant retention like gateway_spend_events
-- (absent from RETENTION_TABLE_CATEGORY_MAP and TABLE_TTL_CONFIG; fixed
-- TTL declared here). Pinned by retentionTtl.unit.test.ts.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.webhook_delivered_events
(
    -- Multitenancy boundary (TenantId = projectId) — every query MUST
    -- filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The spend event's idempotency key (== envelope id).
    GatewayRequestId String CODEC(ZSTD(1)),

    -- The event type enqueued for delivery; one family today.
    EventType LowCardinality(String) DEFAULT 'gateway.request.completed',

    -- The outbox batch the request rode out in (delivery diagnostics).
    BatchId String DEFAULT '' CODEC(ZSTD(1)),

    EnqueuedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
PARTITION BY toYYYYMM(EnqueuedAt)
ORDER BY (TenantId, GatewayRequestId)
TTL toDateTime(EnqueuedAt) + INTERVAL 14 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.webhook_delivered_events;
-- +goose StatementEnd
