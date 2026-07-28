-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Gateway spend events — one UNCONDITIONAL record per gateway request.
--
-- The budget ledger (00017) exists for enforcement and only gets rows when a
-- budget applies; this table is the billing record: every gateway request
-- lands here, budget or no budget, with token classes split out (cache
-- read/write price differently from fresh input on several providers), the
-- rated cost, attribution (org / project / key / principal / end user), and
-- the rich error class the ledger's 3-value status enum collapses.
--
-- Grain: per REQUEST, keyed (TenantId, GatewayRequestId). The trace fold
-- keeps one bookkeeping entry per gateway span precisely so N requests
-- folded under one client traceparent produce N rows here.
--
-- Retention: deliberately EXEMPT from tenant retention. Tenant policies are
-- customer-shrinkable to weeks and retroactively rewrite _retention_days
-- across every mapped table; billing records must not be governed by that.
-- Precedent: metric_usage_estimates / log_usage_estimates (fixed 13-month
-- TTL declared here, table absent from RETENTION_TABLE_CATEGORY_MAP and
-- TABLE_TTL_CONFIG so the reconciler's MODIFY TTL never rewrites this
-- clause). Pinned by retentionTtl.unit.test.ts.
--
-- Reads MUST be replacement-aware (FINAL or argMax): ReplacingMergeTree
-- dedup is eventual, and the reconciliation surface pages over this table.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_events
(
    -- Multitenancy boundary (TenantId = projectId) — every query MUST
    -- filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- Idempotency key: the gateway's per-request ULID. One row per request;
    -- replays collapse at merge time, and the app-side insert probes first
    -- so the read path never sees systematic duplicates.
    GatewayRequestId String CODEC(ZSTD(1)),

    -- Attribution
    OrganizationId String CODEC(ZSTD(1)),
    TeamId String DEFAULT '' CODEC(ZSTD(1)),
    VirtualKeyId String CODEC(ZSTD(1)),
    PrincipalUserId String DEFAULT '' CODEC(ZSTD(1)),
    -- External end-user id (the customer's customer), captured from the
    -- request once the gateway stamps it; empty until then.
    EndUserId String DEFAULT '' CODEC(ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),

    -- What was served
    Model String CODEC(ZSTD(1)),
    -- The provider the gateway actually dispatched to, same identity the
    -- budget ledger's ProviderKey carries. Empty when the gateway did not
    -- report one.
    ProviderKey String DEFAULT '' CODEC(ZSTD(1)),

    -- Metering quantities, by class
    TokensInput UInt64 DEFAULT 0,
    TokensOutput UInt64 DEFAULT 0,
    TokensCacheRead UInt64 DEFAULT 0,
    TokensCacheWrite UInt64 DEFAULT 0,
    TokensReasoning UInt64 DEFAULT 0,

    -- Rated cost at ingest (platform pricing path)
    CostUSD Decimal(18, 6) DEFAULT 0,

    -- Health
    Status LowCardinality(String),                   -- "success" | "error"
    ErrorClass LowCardinality(String) DEFAULT '',    -- gateway error taxonomy token
    HttpStatus UInt16 DEFAULT 0,

    -- Attribution extras
    Labels Array(String) DEFAULT [] CODEC(ZSTD(1)),  -- VK tags at fold time
    Metadata String DEFAULT '' CODEC(ZSTD(1)),       -- caller echo, JSON, capped upstream

    DurationMS UInt32 DEFAULT 0,

    -- Request time — period placement anchors here, never ingest time.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Replacement version for the ReplacingMergeTree.
    EventTimestamp UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventTimestamp)
PARTITION BY toYYYYMM(OccurredAt)
ORDER BY (TenantId, GatewayRequestId)
TTL toDateTime(OccurredAt) + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend_events;
-- +goose StatementEnd
