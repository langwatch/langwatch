-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Where each restatement key currently sits (challenge settlement 9).
--
-- The restatement key is the DIMENSION-ONLY identity of one provider item, and
-- it deliberately excludes the currency, the agent and the spender. That is
-- what lets a corrected figure replace the one it corrects instead of landing
-- beside it -- and it is also what leaves a hole: a provider reissuing the
-- same charge under a different currency, agent or spender files it in a
-- DIFFERENT cell of `governance_cost_rollup_1d`, and the first version is left
-- behind holding its money with nothing to say it was superseded. Read across
-- the day, the one bill is then counted twice.
--
-- This table closes that hole by remembering the cell a key was filed under.
-- Before writing an observation, the puller looks the key up here; a key that
-- turns up under a different cell means the charge is a reissue, and a
-- `lw.obs.pulled_usage.retracted` event is emitted for the old cell first.
--
-- Written by the rollup store in the SAME write as the cell and derived from
-- the same event, so it is a consequence of the event history exactly like the
-- summary is: rebuild the projection from `event_log` and the index comes
-- back. Held only in memory it would be lost by every restart, and searching
-- the day for it would mean reading every row of that day on every correction.
--
-- Sort key is (TenantId, RestatementKey) and nothing else, because that is the
-- question this table answers: given a key, which cell. TenantId comes first
-- because a restatement key is a provider-supplied hash and nothing about it
-- is unique across tenants.
--
-- The cell dimensions are PAYLOAD, not key. Putting them in the sort key would
-- make a reissue a second row rather than a replacement, which is precisely
-- the "both versions live" state this exists to prevent.
--
-- It is NOT PII-free, for the same reason the rollup is not: `RawActorId`
-- carries the provider's own actor identifier verbatim, which for several
-- providers is an email address. The 13-month TTL below bounds how long it is
-- held and matches `governance_cost_rollup_1d`'s, so an index row never
-- outlives the cell it points at.
--
-- Reads must be replacement-aware (argMax over EventTimestamp, per ADR-015):
-- this is a ReplacingMergeTree and its dedup runs in background merges, so
-- between two writes of one key both versions are in the table.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index
(
    -- Multitenancy boundary (TenantId = the org's hidden governance project).
    -- Every query MUST filter on TenantId first.
    TenantId String CODEC(ZSTD(1)),

    -- The provider item's dimension-only identity, as carried on the event.
    RestatementKey String CODEC(ZSTD(1)),

    -- ---- the cell this key sits in: payload, never key ----

    -- The provider's business day (UTC), matching the summary row's own Day.
    Day Date CODEC(Delta(2), ZSTD(1)),

    -- Always 'pulled' today: the gateway lane has no restatement keys. Carried
    -- rather than assumed so the cell recorded here is the whole address.
    CostSource LowCardinality(String) DEFAULT '',

    IngestionSourceId String DEFAULT '' CODEC(ZSTD(1)),
    Provider LowCardinality(String) DEFAULT '',
    Model LowCardinality(String) DEFAULT '',

    -- The three dimensions the restatement key deliberately excludes. They are
    -- the whole point of the table: without them a reissue cannot be told from
    -- the charge it replaces, and the day reads as new spend on top of the old
    -- figure.
    AgentId String DEFAULT '' CODEC(ZSTD(1)),
    CurrencyCode LowCardinality(String) DEFAULT 'USD',
    RawActorId String DEFAULT '' CODEC(ZSTD(1)),

    -- Replacement version for the ReplacingMergeTree, the same value the
    -- summary row it was written beside carries.
    EventTimestamp UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}EventTimestamp)
ORDER BY (TenantId, RestatementKey)
TTL toDateTime(Day) + INTERVAL 13 MONTH DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down

-- Down migrations are intentionally commented out to prevent accidental data
-- loss. To roll back, uncomment and run manually.
--
-- The rows are rebuildable -- this table is written from the same events the
-- cost summary is folded from -- but only by a full replay, so an unattended
-- `goose down` leaves every reissue undetectable until someone runs that
-- replay, and a day silently carries its bill twice in the meantime.

-- +goose StatementBegin
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.governance_cost_rollup_restatement_index;
-- +goose StatementEnd
