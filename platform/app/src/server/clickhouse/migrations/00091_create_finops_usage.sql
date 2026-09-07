-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- finops_usage — the cross-tool AI spend ledger.
--
-- One row per priced unit of AI spend, from any tool the organization pays for:
-- a model API call (Charge = 'usage'), a per-seat licence ('seat'), cloud
-- compute a run consumed ('cloud'), or an activity count that is billed
-- ('activity'). The FinOps and Engineering boards read it to answer "what did
-- this org spend on AI last month, by tool / team / person / model".
--
-- The row is a pre-attributed FACT, not a copy of a provider invoice: the
-- person, team and department a charge belongs to are resolved when the row is
-- written, so a board groups by them without a join. Cost and ListCost are the
-- billed and list-price amounts in USD; the difference is the discount.
--
-- Engine / partition / retention mirror the other analytics facts so partitions
-- age and roll off identically.
--   * ReplacingMergeTree(UpdatedAt) — re-computes are replay-safe; the latest
--     version of a RowId wins. RowId is the charge's stable identity, so the
--     engine collapses a recomputed row onto the one it supersedes.
--   * ORDER BY (TenantId, Day, RowId) — TIME-LEADING. The reads this table
--     exists for are day-bounded scans over a project's spend; Day is the
--     partition key, so always filter it.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.finops_usage_ledger
(
    TenantId String CODEC(ZSTD(1)),
    -- The charge's stable identity: a recomputed charge lands on the same
    -- RowId and the ReplacingMergeTree collapses it.
    RowId String CODEC(ZSTD(1)),
    Day Date CODEC(ZSTD(1)),
    -- usage | seat | cloud | activity
    Charge LowCardinality(String) CODEC(ZSTD(1)),

    -- ── What was billed, and who paid ─────────────────────────────────────
    Tool LowCardinality(String) CODEC(ZSTD(1)),
    Provider LowCardinality(String) CODEC(ZSTD(1)),
    Agent LowCardinality(String) CODEC(ZSTD(1)),
    Model LowCardinality(String) CODEC(ZSTD(1)),
    PersonId String CODEC(ZSTD(1)),
    PersonName String CODEC(ZSTD(1)),
    TeamId LowCardinality(String) CODEC(ZSTD(1)),
    TeamName LowCardinality(String) CODEC(ZSTD(1)),
    DepartmentId LowCardinality(String) CODEC(ZSTD(1)),
    DepartmentName LowCardinality(String) CODEC(ZSTD(1)),
    Resource LowCardinality(String) CODEC(ZSTD(1)),
    KeyId String CODEC(ZSTD(1)),

    -- ── The measures ──────────────────────────────────────────────────────
    Requests UInt64 CODEC(ZSTD(1)),
    Units Float64 CODEC(ZSTD(1)),
    Unit LowCardinality(String) CODEC(ZSTD(1)),
    TokensIn UInt64 CODEC(ZSTD(1)),
    TokensOut UInt64 CODEC(ZSTD(1)),
    CacheRead UInt64 CODEC(ZSTD(1)),
    CacheWrite UInt64 CODEC(ZSTD(1)),
    Errors UInt64 CODEC(ZSTD(1)),
    Cost Float64 CODEC(ZSTD(1)),
    ListCost Float64 CODEC(ZSTD(1)),

    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)),

    `_retention_days` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYYYYMM(Day)
ORDER BY (TenantId, Day, RowId)
TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: the only rollback is dropping the table, which destroys every
-- spend row it holds, and an automated `goose down` is exactly the way that
-- happens by accident. So the statement is written out but left commented, and
-- `down` is deliberately a no-op: re-running `up` is idempotent, and a rollback
-- that has to be pasted by hand is one somebody decided on.
--
-- To roll back, uncomment and run manually:
-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.finops_usage_ledger;
