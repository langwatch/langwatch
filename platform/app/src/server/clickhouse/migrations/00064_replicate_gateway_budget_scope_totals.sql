-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_scope_totals: move to the Replicated engine and rebuild
-- from the ledger.
--
-- When CLICKHOUSE_CLUSTER is set the database engine is Replicated (00001),
-- which replicates DDL to every node but NOT table data: data only
-- replicates through Replicated*MergeTree table engines. This table was
-- created with a plain AggregatingMergeTree, so on a multi-replica cluster
-- every replica accumulates a PRIVATE copy: the materialized view folds a
-- debit only on the replica whose connection received the ledger insert,
-- and reads through the load balancer return whichever replica they happen
-- to hit. Budget enforcement reads this table, so a cap can be checked
-- against a fraction of the true spend. The engine below substitutes to
-- ReplicatedAggregatingMergeTree on clustered deployments (the same
-- mechanism every ReplacingMergeTree table uses via
-- CLICKHOUSE_ENGINE_REPLACING_PREFIX), so a single fold on the
-- insert-receiving replica replicates to all nodes.
--
-- Engine aside, the rebuild + swap + reconciliation below is 00058's
-- statement order, and its exactly-once argument carries over unchanged:
--
--   1. The rebuild lands in a scratch table, so the live rollup serves
--      reads until the swap; there is no instant where reads see an
--      empty or missing table.
--   2. The view is dropped before the rebuild's ledger snapshot, so no
--      fold runs concurrently with the snapshot. Debits inserted while
--      no view exists land only in the ledger, losing nothing.
--   3. EXCHANGE TABLES swaps the rebuilt rollup in atomically.
--   4. The view is recreated; folding resumes against the rebuilt table.
--   5. Reconciliation: the ledger is re-aggregated into a scratch
--      snapshot, then a delta insert adds, per rollup key, exactly the
--      amount present in the ledger but not yet in the rollup. A debit
--      that landed between the rebuild snapshot and the view creation is
--      added here exactly once; a debit folded by the recreated view
--      contributes a zero delta. The ledger snapshot is taken in its own
--      statement, strictly before the rollup is read, and a fold is
--      synchronous with its ledger insert, so a concurrently folded
--      debit is always seen on the rollup side too and never re-added.
--      Deltas clamp at zero: the insert only ever adds spend the rollup
--      is missing. The one drift this cannot repair is a key that
--      receives debits both inside the swap interval (two DDL
--      statements) and inside the reconciliation pass itself; the
--      shortfall is bounded by those debits, the ledger keeps them, and
--      the drift expires with the period bucket.
--
-- Single-connection correctness on a cluster: goose runs every statement
-- through one connection, i.e. on one replica. The DDL statements
-- (CREATE / DROP / EXCHANGE) replicate through the database engine. The
-- INSERT ... SELECT statements execute only on the connected replica, but
-- they read gateway_budget_ledger_events, which is a Replicated engine and
-- therefore identical on every replica, and they write into Replicated
-- tables, so the rebuilt rows replicate to every node. No statement reads
-- from the pre-swap rollup: on a cluster its per-replica content is
-- partial by construction, so the ledger is the only source used. (The
-- reconciliation's LEFT JOIN reads the rollup only AFTER the swap, when
-- it holds the rebuilt, replicated content.)
--
-- Re-run safety (the runner may re-apply a partially executed file after
-- a crash): the scratch tables are DROPPED and recreated rather than
-- truncated and reused. This matters because the migration converts the
-- engine: after a crash between the EXCHANGE and the final drops, the
-- scratch NAME holds the old plain-engine table, and truncating and
-- reusing it would rebuild into the wrong engine and swap the plain
-- engine back in. Dropping always recreates the scratch with the correct
-- engine, the rebuild re-derives its content from the current ledger, and
-- the reconciliation re-derives its delta, so every complete run
-- converges to the same state.
--
-- On a single-node deployment (CLICKHOUSE_CLUSTER unset) the engine
-- substitutions resolve to the plain engines, the rebuild reproduces the
-- same totals the table already holds, and the swap is a behavioral
-- no-op.
-- ============================================================================

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild
(
    TenantId String CODEC(ZSTD(1)),
    Scope LowCardinality(String),
    ScopeId String CODEC(ZSTD(1)),
    Window LowCardinality(String),
    PeriodStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    SpendUSD AggregateFunction(sum, Decimal(18, 6)),
    TokensInput AggregateFunction(sum, UInt64),
    TokensOutput AggregateFunction(sum, UInt64),
    TokensCacheRead AggregateFunction(sum, UInt64),
    TokensCacheWrite AggregateFunction(sum, UInt64),
    RequestCount AggregateFunction(count, UInt64),

    UpdatedAt SimpleAggregateFunction(max, DateTime64(3)) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
PARTITION BY toYYYYMM(PeriodStart)
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild
    (TenantId, Scope, ScopeId, Window, PeriodStart, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount)
SELECT
    TenantId,
    Scope,
    ScopeId,
    Window,
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1, 'UTC'), 3, 'UTC'),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt, 'UTC'), 3, 'UTC'),
                           toDateTime64(0, 3, 'UTC')
    ) AS PeriodStart,
    sumState(AmountUSD) AS SpendUSD,
    sumState(toUInt64(TokensInput)) AS TokensInput,
    sumState(toUInt64(TokensOutput)) AS TokensOutput,
    sumState(toUInt64(TokensCacheRead)) AS TokensCacheRead,
    sumState(toUInt64(TokensCacheWrite)) AS TokensCacheWrite,
    countState() AS RequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events FINAL
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart;
-- +goose StatementEnd

-- +goose StatementBegin
EXCHANGE TABLES ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals AND ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild;
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
    -- All branches must return DateTime64(3) to match the target column,
    -- and every function names 'UTC' so the boundary truncated to is the
    -- one the reader computes, on any server. The outer toDateTime64 needs
    -- the timezone too: toStartOfWeek and toStartOfMonth return a Date,
    -- and converting a Date to DateTime64 without one re-interprets
    -- midnight in the server timezone, which puts the drift right back.
    -- toStartOfWeek mode 1 is Monday, matching the reader's ISO week.
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1, 'UTC'), 3, 'UTC'),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt, 'UTC'), 3, 'UTC'),
        -- TOTAL and anything unrecognised: one lifetime bucket.
                           toDateTime64(0, 3, 'UTC')
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

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon
(
    TenantId String CODEC(ZSTD(1)),
    Scope LowCardinality(String),
    ScopeId String CODEC(ZSTD(1)),
    Window LowCardinality(String),
    PeriodStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),

    TrueSpendUSD Decimal(38, 6),
    TrueTokensInput UInt64,
    TrueTokensOutput UInt64,
    TrueTokensCacheRead UInt64,
    TrueTokensCacheWrite UInt64,
    TrueRequestCount UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon
SELECT
    TenantId,
    Scope,
    ScopeId,
    Window,
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1, 'UTC'), 3, 'UTC'),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt, 'UTC'), 3, 'UTC'),
                           toDateTime64(0, 3, 'UTC')
    ) AS PeriodStart,
    sum(AmountUSD) AS TrueSpendUSD,
    sum(toUInt64(TokensInput)) AS TrueTokensInput,
    sum(toUInt64(TokensOutput)) AS TrueTokensOutput,
    sum(toUInt64(TokensCacheRead)) AS TrueTokensCacheRead,
    sum(toUInt64(TokensCacheWrite)) AS TrueTokensCacheWrite,
    count() AS TrueRequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events FINAL
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    (TenantId, Scope, ScopeId, Window, PeriodStart, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount)
SELECT
    r.TenantId,
    r.Scope,
    r.ScopeId,
    r.Window,
    r.PeriodStart,
    arrayReduce('sumState', [toDecimal64(greatest(r.TrueSpendUSD - c.CurSpendUSD, 0), 6)]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensInput) - toInt64(c.CurTokensInput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensOutput) - toInt64(c.CurTokensOutput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheRead) - toInt64(c.CurTokensCacheRead), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheWrite) - toInt64(c.CurTokensCacheWrite), 0))]),
    arrayReduce('countState', range(toUInt64(greatest(toInt64(r.TrueRequestCount) - toInt64(c.CurRequestCount), 0))))
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon AS r
LEFT JOIN (
    SELECT
        TenantId, Scope, ScopeId, Window, PeriodStart,
        sumMerge(SpendUSD) AS CurSpendUSD,
        sumMerge(TokensInput) AS CurTokensInput,
        sumMerge(TokensOutput) AS CurTokensOutput,
        sumMerge(TokensCacheRead) AS CurTokensCacheRead,
        sumMerge(TokensCacheWrite) AS CurTokensCacheWrite,
        countMerge(RequestCount) AS CurRequestCount
    FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart
) AS c USING (TenantId, Scope, ScopeId, Window, PeriodStart)
WHERE r.TrueSpendUSD > c.CurSpendUSD
   OR r.TrueRequestCount > c.CurRequestCount
   OR r.TrueTokensInput > c.CurTokensInput
   OR r.TrueTokensOutput > c.CurTokensOutput
   OR r.TrueTokensCacheRead > c.CurTokensCacheRead
   OR r.TrueTokensCacheWrite > c.CurTokensCacheWrite
-- The delta arithmetic and the WHERE filter both rely on an unmatched
-- LEFT JOIN row carrying zero-valued Cur* columns. A server or profile
-- with join_use_nulls = 1 would make them NULL instead, so the setting
-- is pinned on the statement.
SETTINGS join_use_nulls = 0;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- IRREVERSIBLE: the swap discards the plain-engine table this migration
-- replaces, and moving back to a plain engine on a cluster would resume
-- scattering folds across replicas. Rollback statements stay commented
-- out and must be applied manually if ever needed.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
