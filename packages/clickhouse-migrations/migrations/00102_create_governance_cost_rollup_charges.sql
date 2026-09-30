-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Governance's own record of every pulled charge: one row per
-- `lw.obs.pulled_usage.observed` or `.retracted` event, written by the
-- `governanceCostCharges` map projection beside the `governanceCostRollup`
-- fold, from the same events. The daily drift check (cost-rollup-watch.feature)
-- re-derives each day's cells from these rows and holds them against
-- `governance_cost_rollup_1d`, so the check never reads `event_log`, which is
-- eventing's alone (ARCHITECTURE.md section 7).
--
-- One row per event: ORDER BY (TenantId, Day, EventId) under a
-- ReplacingMergeTree, so a redelivered event collapses onto itself. Reads use
-- FINAL over one tenant's day.
--
-- NOT PII-free, like the rollup: `RawActorId` carries the provider's actor
-- identifier (the erasure pseudonym once erased; the erasure overwrites it in
-- place). Retention matches `governance_cost_rollup_1d` (00095): kept
-- indefinitely unless a day count is deliberately stamped.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_charges
(
    -- Multitenancy boundary. Every query MUST filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The provider's business day (UTC) the charge is filed under.
    Day Date CODEC(Delta(2), ZSTD(1)),

    EventId String CODEC(ZSTD(1)),

    -- ---- the rollup cell, exactly as the fold addresses it ----
    CostSource LowCardinality(String) DEFAULT '',
    IngestionSourceId String DEFAULT '' CODEC(ZSTD(1)),
    Provider LowCardinality(String) DEFAULT '',
    Model LowCardinality(String) DEFAULT '',
    AgentId String DEFAULT '' CODEC(ZSTD(1)),
    CurrencyCode LowCardinality(String) DEFAULT 'USD',
    RawActorId String DEFAULT '' CODEC(ZSTD(1)),

    -- ---- the item this charge moves, and what it says the item holds ----
    RestatementKey String CODEC(ZSTD(1)),
    IsRetraction UInt8 DEFAULT 0,
    ObservedAtMs Int64,
    AmountNanoMinor Int64,

    -- The event's own moment, the one the rollup's LastEventOccurredAt reads.
    EventOccurredAt UInt64,

    -- Indefinite by default (0), as the rollup's own (00095): a charge must
    -- outlive nothing the summary still holds.
    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventOccurredAt)
PARTITION BY toYYYYMM(Day)
ORDER BY (TenantId, Day, EventId)
TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually. The rows are rebuildable only
-- by replaying the pulled-usage pipeline's map projection.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_charges;
-- +goose StatementEnd
