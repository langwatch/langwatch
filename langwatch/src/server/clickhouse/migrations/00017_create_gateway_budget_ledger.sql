-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- AI Gateway Budget Ledger — ClickHouse event-sourced mirror of the PG
-- GatewayBudgetLedger table (see prisma/schema.prisma model of the same
-- name). Designed for the scale target of millions of requests per day per
-- tenant, where Postgres ledger rows become unworkable (table bloat,
-- sequential-scan aggregation, checkpoint pressure).
--
-- Read path: the hot /budget/check endpoint still queries PG for the last
-- 24h (bounded cardinality), but long-horizon projections (monthly spend,
-- per-VK trend, ops dashboards) will read from this CH table instead, using
-- the pre-aggregated gateway_budget_scope_totals ReplacingMergeTree below.
--
-- Write path (next iter): BudgetOutbox.Flush dual-writes to PG and CH during
-- the shadow-migrate window, then cutover PG to a 24h-retained hot buffer.
-- Idempotency is preserved via (BudgetId, GatewayRequestId) uniqueness —
-- the ORDER BY + ReplacingMergeTree dedup collapses replays safely.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
(
    -- Multitenancy boundary — every query MUST filter on TenantId first
    TenantId String CODEC(ZSTD(1)),

    -- Budget + identity
    BudgetId String CODEC(ZSTD(1)),
    Scope LowCardinality(String),                    -- "org" | "team" | "project" | "virtual_key"
    ScopeId String CODEC(ZSTD(1)),                   -- org_xxx | team_xxx | project_xxx | vk_xxx
    Window LowCardinality(String),                   -- "DAY" | "WEEK" | "MONTH"
    VirtualKeyId String CODEC(ZSTD(1)),
    ProviderCredentialId String DEFAULT '' CODEC(ZSTD(1)),

    -- Idempotency — ULID produced by the gateway per request. (BudgetId,
    -- GatewayRequestId) is the dedup key mirrored from PG's @@unique.
    GatewayRequestId String CODEC(ZSTD(1)),

    -- Debit payload
    AmountUSD Decimal(18, 6) CODEC(ZSTD(1)),
    TokensInput UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    TokensOutput UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    TokensCacheRead UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    TokensCacheWrite UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),

    -- Call metadata
    Model String CODEC(ZSTD(1)),
    ProviderSlot LowCardinality(String),
    DurationMS UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
    Status LowCardinality(String),                   -- "success" | "provider_error" | "blocked_by_guardrail"

    -- Timing — OccurredAt is the partition key + sort-key leaf so range
    -- queries prune partitions and read only the relevant granules.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    CreatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    -- Version column for ReplacingMergeTree: on idempotent re-writes (same
    -- TenantId/BudgetId/GatewayRequestId), the row with the highest
    -- EventTimestamp wins. Ingestors set this to the outbox-flush time.
    EventTimestamp UInt64 CODEC(Delta(8), ZSTD(1)),

    INDEX idx_virtual_key (TenantId, VirtualKeyId) TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_gateway_request (TenantId, GatewayRequestId) TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventTimestamp)
PARTITION BY toYearMonth(OccurredAt)
ORDER BY (TenantId, BudgetId, GatewayRequestId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- gateway_budget_scope_totals — pre-aggregated running totals per
-- (Scope, ScopeId, Window, PeriodStart). The /budget/scope UI and any
-- monthly-spend dashboard read from this table in O(1) per scope.
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
(
    TenantId String CODEC(ZSTD(1)),
    Scope LowCardinality(String),
    ScopeId String CODEC(ZSTD(1)),
    Window LowCardinality(String),
    PeriodStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- SumState aggregates for merge-on-read
    SpendUSD AggregateFunction(sum, Decimal(18, 6)),
    TokensInput AggregateFunction(sum, UInt64),
    TokensOutput AggregateFunction(sum, UInt64),
    TokensCacheRead AggregateFunction(sum, UInt64),
    TokensCacheWrite AggregateFunction(sum, UInt64),
    RequestCount AggregateFunction(count, UInt64),

    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYearMonth(PeriodStart)
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
CREATE MATERIALIZED VIEW IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv
TO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
AS
SELECT
    TenantId,
    Scope,
    ScopeId,
    Window,
    toStartOfInterval(
        OccurredAt,
        INTERVAL 1
            multiIf(Window = 'DAY', DAY, Window = 'WEEK', WEEK, Window = 'MONTH', MONTH, DAY)
    ) AS PeriodStart,
    sumState(AmountUSD) AS SpendUSD,
    sumState(toUInt64(TokensInput)) AS TokensInput,
    sumState(toUInt64(TokensOutput)) AS TokensOutput,
    sumState(toUInt64(TokensCacheRead)) AS TokensCacheRead,
    sumState(toUInt64(TokensCacheWrite)) AS TokensCacheWrite,
    countState() AS RequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals;
-- +goose StatementEnd

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events;
-- +goose StatementEnd

-- +goose ENVSUB OFF
