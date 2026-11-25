-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Gateway spend, the per-request billing record, projected from the
-- gateway_spend_processing command pipeline (lw.gateway.spend.* events).
--
-- One aggregate per gateway REQUEST: the gateway records admission before
-- any provider outcome, so blocked and failed requests have rows here too,
-- and a request whose confirmation never arrived is SETTLED visibly
-- (NeedsReconciliation = 1) instead of silently missing. Spans join on
-- GatewayRequestId for observability; they are not load-bearing for money.
--
-- Money: integer nano-USD (CostNanoUSD, 1e-9 USD) priced once when the
-- outcome command is appended, from integer token quantities, and carried
-- on the event with the RateVersion that produced it; the fold copies both.
-- Sums stay in integers; the one further rounding belongs to the
-- customer's invoice.
--
-- Retention: deliberately EXEMPT from tenant retention. Tenant policies
-- are customer-shrinkable to weeks and retroactively rewrite
-- per-project retention day macros across every mapped table; billing records must not be
-- governed by that. Precedent: the usage-estimate ledgers (fixed 13-month
-- TTL declared here, table absent from RETENTION_TABLE_CATEGORY_MAP and
-- TABLE_TTL_CONFIG so the reconciler's whole-clause MODIFY TTL never
-- rewrites this clause). Pinned by retentionTtl.unit.test.ts.
--
-- No content: ids, quantities, classes, and the caller's own metadata echo.
-- No prompts, no responses, no PII.
--
-- Reads MUST be replacement-aware (FINAL or argMax): the fold writes one
-- ReplacingMergeTree version per lifecycle transition and RMT dedup is
-- eventual.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend
(
    -- Multitenancy boundary (TenantId = projectId), every query MUST
    -- filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The gateway request ULID: minted before the provider call, stable
    -- across retries, replays, and the external webhook event_id.
    GatewayRequestId String CODEC(ZSTD(1)),

    -- Attribution
    OrganizationId String CODEC(ZSTD(1)),
    VirtualKeyId String CODEC(ZSTD(1)),
    PrincipalUserId String DEFAULT '' CODEC(ZSTD(1)),
    EndUserId String DEFAULT '' CODEC(ZSTD(1)),
    TraceId String DEFAULT '' CODEC(ZSTD(1)),

    -- What was served
    Model String CODEC(ZSTD(1)),
    -- ModelProvider row id the gateway dispatched to; same identity the
    -- budget ledger's ProviderKey carries. Empty when unresolved.
    ProviderKey String DEFAULT '' CODEC(ZSTD(1)),

    -- Wire shape served (chat, embeddings, responses, ...).
    RequestType LowCardinality(String) DEFAULT '',

    -- Lifecycle: admitted -> confirmed | failed | settled.
    Status LowCardinality(String),
    -- Full gateway error taxonomy token; never a collapsed enum.
    ErrorClass LowCardinality(String) DEFAULT '',
    HttpStatus UInt16 DEFAULT 0,
    -- 1 when settlement fired and no real outcome has resolved it yet.
    NeedsReconciliation UInt8 DEFAULT 0,
    SettleReason LowCardinality(String) DEFAULT '',

    -- Metering quantities, by class (exact integers)
    TokensInput UInt64 DEFAULT 0,
    TokensOutput UInt64 DEFAULT 0,
    TokensCacheRead UInt64 DEFAULT 0,
    TokensCacheWrite UInt64 DEFAULT 0,
    TokensReasoning UInt64 DEFAULT 0,

    -- Rated cost: integer nano-USD + the rate identity it was priced with,
    -- so a replay re-rates deterministically and a price correction is a
    -- projection rebuild.
    CostNanoUSD Int64 DEFAULT 0,
    RateVersion LowCardinality(String) DEFAULT '',

    -- Attribution extras
    Labels Array(String) DEFAULT [] CODEC(ZSTD(1)),
    Metadata String DEFAULT '' CODEC(ZSTD(1)),

    -- Emission provenance: per-pod monotonic sequencing for the gap
    -- detector (a hole in (PodId, PodSeq) is an asserted loss).
    PodId String DEFAULT '' CODEC(ZSTD(1)),
    PodSeq UInt64 DEFAULT 0,

    DurationMS UInt32 DEFAULT 0,

    -- Request time (admission), period placement anchors here, never
    -- ingest time.
    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    -- Projection stamp: the fold's schema-snapshot version. Read-back only
    -- trusts rows carrying the current stamp.
    Version LowCardinality(String) DEFAULT '',

    -- Fold bookkeeping, round-tripped so the delivery path never refolds
    -- from the event log in steady state.
    CreatedAt UInt64 DEFAULT 0,
    LastEventOccurredAt UInt64 DEFAULT 0,

    -- Replacement version for the ReplacingMergeTree (the fold's monotonic
    -- updatedAt).
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
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_spend;
-- +goose StatementEnd
