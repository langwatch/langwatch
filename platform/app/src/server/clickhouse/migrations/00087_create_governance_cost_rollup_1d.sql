-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Governance daily cost rollup, projected from the cost command pipelines by
-- the `governanceCostRollup` fold (ADR-128 wave 1).
--
-- One row per (day x dimension combination). The row is a pure consequence of
-- the event history: rebuild the projection from `event_log` and the same
-- numbers come back.
--
-- TWO writers, and they can never contend for the same row: the fold is
-- registered on the gateway-spend pipeline AND on the pulled-usage pipeline,
-- and `CostSource` is IN the sort key, so a gateway row and a pulled row are
-- different rows by construction. The trace lane is reserved and EXCLUDED from
-- wave 1 — no pipeline carrying trace cost registers this fold, so no
-- `CostSource` value for it exists.
--
-- Sort key = the fold's group key, exactly. Anything the fold groups by must
-- be here or the first background merge silently deletes a spender's money
-- (the migration-00069 bug class ADR-128 names). `RawActorId` is what keeps
-- two different spenders with identical numbers two rows; `CurrencyCode` is
-- what keeps two currencies two figures.
--
-- `ExactOrEstimate` is deliberately OUTSIDE the sort key. A provider moving a
-- day from estimate to exact is a RESTATEMENT of that day, not a new key: the
-- newer row wins on `EventTimestamp` and replaces the old figure. Were it in
-- the key, the estimate and the invoice would both survive and the day would
-- read as double its cost.
--
-- `OrganizationId` is payload, not key. Ownership of the money is an attribute
-- of the row; the row's ADDRESS is the tenant it is stored under (TenantId =
-- the org's hidden governance project) plus the day and the dimensions. Adding
-- it to the key would buy no separation TenantId does not already give and
-- would make an org rename a key change.
--
-- Money: integer nano units, never floats. `AmountNanoUsd` is the USD figure
-- and is NULLABLE ON PURPOSE — NULL means "we hold no USD figure for this
-- row", which is a different fact from zero spend, and a 0 here would be read
-- and charted as real zero-cost usage. `AmountNanoMinor` is the provider's own
-- figure in `CurrencyCode`'s nano-minor units; for the USD rows both of
-- wave 1's producers emit, the two are equal.
--
-- Retention: deliberately EXEMPT from tenant retention, following
-- `gateway_spend` (00067). Cost records must not be governed by a policy a
-- customer can shrink to weeks; a fixed 13-month TTL is declared here, and the
-- table is absent from RETENTION_TABLE_CATEGORY_MAP and TABLE_TTL_CONFIG so
-- the reconciler's whole-clause MODIFY TTL never rewrites this line. Pinned by
-- retentionTtl.unit.test.ts.
--
-- No content: ids, quantities and money. No prompts, no responses, no PII.
--
-- Reads MUST be replacement-aware (argMax over EventTimestamp, per ADR-015):
-- the fold writes one version per fold cycle and RMT dedup is eventual, so a
-- plain SUM over this table double-counts every row it has written twice.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d
(
    -- Multitenancy boundary (TenantId = the org's hidden governance project).
    -- Every query MUST filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The provider's business day (UTC), never ingest day. A restatement of a
    -- day keeps this unchanged; that is what lets the new figure replace the
    -- old one instead of landing beside it.
    Day Date CODEC(Delta(2), ZSTD(1)),

    -- Which lane the money came from: 'gateway' or 'pulled'. The trace lane is
    -- reserved and unused in wave 1.
    CostSource LowCardinality(String),

    -- The IngestionSource row that owns the pulled attribution. Empty for the
    -- gateway lane, which has no ingestion source.
    IngestionSourceId String DEFAULT '' CODEC(ZSTD(1)),

    -- Who served it: the pulled source type ('anthropic_admin', ...) for the
    -- pulled lane, the resolved ModelProvider row id for the gateway lane.
    Provider LowCardinality(String) DEFAULT '',
    Model LowCardinality(String) DEFAULT '',

    -- The agent/application within the source, when the provider names one.
    AgentId String DEFAULT '' CODEC(ZSTD(1)),

    -- The currency the provider stated the figure in. In the key: two
    -- currencies are two totals and must never merge into one number.
    CurrencyCode LowCardinality(String) DEFAULT 'USD',

    -- The provider's own actor identifier (email, GUID, API key id) exactly as
    -- it arrived — a permanent fact, never rewritten. Person and department
    -- are NOT stamped here; they are resolved at read time so historical cost
    -- stays under the department it was spent by.
    RawActorId String DEFAULT '' CODEC(ZSTD(1)),

    -- ---- payload (not part of the row's identity) ----

    -- Who the money belongs to. See the header: address vs ownership.
    OrganizationId String DEFAULT '' CODEC(ZSTD(1)),

    -- 'exact' once the provider will invoice this figure, 'estimate' before.
    -- Outside the key on purpose — see the header.
    ExactOrEstimate LowCardinality(String) DEFAULT '',

    -- The money. NULL, never 0, when no USD figure is held.
    AmountNanoUsd Nullable(Int64) DEFAULT NULL,
    -- The provider's own figure, in CurrencyCode's nano-minor units.
    AmountNanoMinor Int64 DEFAULT 0,

    TokensInput UInt64 DEFAULT 0,
    TokensOutput UInt64 DEFAULT 0,
    TokensCacheRead UInt64 DEFAULT 0,
    TokensCacheWrite UInt64 DEFAULT 0,
    RequestCount UInt64 DEFAULT 0,

    -- Restatement history, so a reader can see the day was revised and what it
    -- was before rather than only that the number changed.
    RevisionCount UInt32 DEFAULT 0,
    PreviousAmountNanoUsd Nullable(Int64) DEFAULT NULL,

    -- The pulled lane's per-item latest contributions, JSON, keyed by the
    -- item's restatement key. This is what makes a restatement REPLACE rather
    -- than add: the fold keeps the newest observation per item and the row's
    -- total is their sum. Bounded by the number of distinct provider ITEMS
    -- sharing one day+dimension cell, which is 1 for the bucketed admin-API
    -- pullers wave 1 ships (the restatement key hashes the same coordinates
    -- this row is keyed by). A message-grain puller would not be bounded and
    -- must not adopt this column without revisiting it.
    PulledItemsJson String DEFAULT '' CODEC(ZSTD(3)),

    -- Projection stamp: the fold's schema-snapshot version. Read-back only
    -- trusts rows carrying the current stamp.
    Version LowCardinality(String) DEFAULT '',

    -- The executor's redelivery-dedup watermark (00054 precedent). Without it
    -- a retry re-applies a batch the previous attempt already committed, and
    -- because this fold ACCUMULATES the row silently doubles.
    AppliedEventIds Array(String) DEFAULT [] CODEC(ZSTD(1)),

    -- Fold bookkeeping, round-tripped so the delivery path never refolds from
    -- the event log in steady state.
    CreatedAt UInt64 DEFAULT 0,
    LastEventOccurredAt UInt64 DEFAULT 0,

    -- Replacement version for the ReplacingMergeTree (the fold's monotonic
    -- updatedAt).
    EventTimestamp UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventTimestamp)
PARTITION BY toYYYYMM(Day)
ORDER BY (TenantId, Day, CostSource, IngestionSourceId, Provider, Model, AgentId, CurrencyCode, RawActorId)
TTL toDateTime(Day) + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_1d;
-- +goose StatementEnd
