-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_scope_totals: aggregate at the ledger's grain, per BUDGET,
-- not per scope bucket.
--
-- The ledger writes one row per (budget, request): a request that resolves
-- three applicable budgets writes three rows carrying the same true cost,
-- one per budget. That is correct and is what makes each budget's spend
-- knowable. The rollup then aggregated those rows by
-- (TenantId, Scope, ScopeId, Window, PeriodStart) with no BudgetId, so two
-- budgets sharing a scope, a scope id and a window -- a hard cap and a soft
-- cap on one virtual key, the standard provisioning pattern -- collapsed
-- into ONE aggregate holding the sum of both budgets' rows. Every read of
-- that bucket then reported N times the true spend, where N is the number of
-- budgets sharing it. A $5.00 hard cap refused traffic at $2.50 of real
-- spend, and an 80% soft cap warned at 40%.
--
-- The rollup key now carries BudgetId, so the aggregate grain matches the
-- ledger grain and a read that names its budget gets exactly that budget's
-- rows. Correctness follows from the ledger's own key: rows are unique on
-- (TenantId, BudgetId, GatewayRequestId), so within one BudgetId every
-- request contributes its cost exactly once, and no sibling budget's row
-- can enter the aggregate at all.
--
-- BudgetId is appended LAST in the sorting key rather than inserted near
-- the front, which is what keeps this a zero-gap rollout:
--
--   * Readers that bind the whole old prefix (TenantId, Scope, ScopeId,
--     Window, PeriodStart) -- which is every reader, old and new -- keep
--     their index seek unchanged; BudgetId narrows the last key column.
--   * A reader that has not yet learned about BudgetId still aggregates
--     the finer rows back up to the scope bucket and gets precisely the
--     number it got before. Deploy order therefore does not matter, and a
--     code rollback does not need a data rollback.
--
-- Why a rebuild-and-swap and not ALTER MODIFY ORDER BY: ClickHouse rejects
-- appending a column to the sorting key when that column already exists on
-- the table ("Existing column is used in the expression that was added to
-- the sorting key"), and BudgetId has to exist to be read. A scratch table
-- created with the intended key from the start sidesteps that entirely.
--
-- Statement order, and its exactly-once argument, are 00064's verbatim:
--
--   1. The rebuild lands in a scratch table, so the live rollup serves
--      reads until the swap; there is no instant where reads see an
--      empty or missing table.
--   2. The view is dropped before the rebuild's ledger snapshot, so no
--      fold runs concurrently with the snapshot. Debits inserted while
--      no view exists land only in the ledger, losing nothing.
--   3. EXCHANGE TABLES swaps the rebuilt rollup in atomically.
--   4. The view is recreated at the new grain; folding resumes.
--   5. Reconciliation: the ledger is re-aggregated into a scratch
--      snapshot, then a delta insert adds, per rollup key, exactly the
--      amount present in the ledger but not yet in the rollup. A debit
--      that landed between the rebuild snapshot and the view creation is
--      added here exactly once; a debit folded by the recreated view
--      contributes a zero delta. Deltas clamp at zero.
--
-- This doubles as the backfill the fix needs: existing aggregates are wrong
-- wherever siblings shared a bucket, and they are not repairable in place
-- because the collapsed sum no longer says how many budgets fed it. Every
-- row is therefore re-derived from gateway_budget_ledger_events, which was
-- never wrong. Re-running the whole file converges to the same state: the
-- scratch tables are dropped and recreated rather than truncated, the
-- rebuild re-derives its content from the current ledger, and the
-- reconciliation re-derives its delta.
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
    -- The budget the debit was written for. Same identity as the ledger's
    -- BudgetId; last in the sorting key so the pre-existing prefix seek is
    -- untouched.
    BudgetId String CODEC(ZSTD(1)),

    SpendUSD AggregateFunction(sum, Decimal(18, 6)),
    TokensInput AggregateFunction(sum, UInt64),
    TokensOutput AggregateFunction(sum, UInt64),
    TokensCacheRead AggregateFunction(sum, UInt64),
    TokensCacheWrite AggregateFunction(sum, UInt64),
    RequestCount AggregateFunction(count, UInt64),

    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = ${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}
PARTITION BY toYYYYMM(PeriodStart)
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild
    (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount)
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
    BudgetId,
    sumState(AmountUSD) AS SpendUSD,
    sumState(toUInt64(TokensInput)) AS TokensInput,
    sumState(toUInt64(TokensOutput)) AS TokensOutput,
    sumState(toUInt64(TokensCacheRead)) AS TokensCacheRead,
    sumState(toUInt64(TokensCacheWrite)) AS TokensCacheWrite,
    countState() AS RequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events FINAL
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId;
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
    -- one the reader computes, on any server. toStartOfWeek mode 1 is
    -- Monday, matching the reader's ISO week.
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1, 'UTC'), 3, 'UTC'),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt, 'UTC'), 3, 'UTC'),
        -- TOTAL and anything unrecognised: one lifetime bucket.
                           toDateTime64(0, 3, 'UTC')
    ) AS PeriodStart,
    -- Grouping by the budget is the whole fix: without it two budgets on
    -- one bucket fold into a single aggregate holding both their rows.
    BudgetId,
    sumState(AmountUSD) AS SpendUSD,
    sumState(toUInt64(TokensInput)) AS TokensInput,
    sumState(toUInt64(TokensOutput)) AS TokensOutput,
    sumState(toUInt64(TokensCacheRead)) AS TokensCacheRead,
    sumState(toUInt64(TokensCacheWrite)) AS TokensCacheWrite,
    countState() AS RequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId;
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
    BudgetId String CODEC(ZSTD(1)),

    TrueSpendUSD Decimal(38, 6),
    TrueTokensInput UInt64,
    TrueTokensOutput UInt64,
    TrueTokensCacheRead UInt64,
    TrueTokensCacheWrite UInt64,
    TrueRequestCount UInt64
)
ENGINE = ${CLICKHOUSE_ENGINE_MERGETREE:-MergeTree()}
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId)
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
    BudgetId,
    sum(AmountUSD) AS TrueSpendUSD,
    sum(toUInt64(TokensInput)) AS TrueTokensInput,
    sum(toUInt64(TokensOutput)) AS TrueTokensOutput,
    sum(toUInt64(TokensCacheRead)) AS TrueTokensCacheRead,
    sum(toUInt64(TokensCacheWrite)) AS TrueTokensCacheWrite,
    count() AS TrueRequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events FINAL
WHERE Status = 'success'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId;
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount)
SELECT
    r.TenantId,
    r.Scope,
    r.ScopeId,
    r.Window,
    r.PeriodStart,
    r.BudgetId,
    arrayReduce('sumState', [toDecimal64(greatest(r.TrueSpendUSD - c.CurSpendUSD, 0), 6)]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensInput) - toInt64(c.CurTokensInput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensOutput) - toInt64(c.CurTokensOutput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheRead) - toInt64(c.CurTokensCacheRead), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheWrite) - toInt64(c.CurTokensCacheWrite), 0))]),
    arrayReduce('countState', range(toUInt64(greatest(toInt64(r.TrueRequestCount) - toInt64(c.CurRequestCount), 0))))
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon AS r
LEFT JOIN (
    SELECT
        TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId,
        sumMerge(SpendUSD) AS CurSpendUSD,
        sumMerge(TokensInput) AS CurTokensInput,
        sumMerge(TokensOutput) AS CurTokensOutput,
        sumMerge(TokensCacheRead) AS CurTokensCacheRead,
        sumMerge(TokensCacheWrite) AS CurTokensCacheWrite,
        countMerge(RequestCount) AS CurRequestCount
    FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId
) AS c USING (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId)
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

-- IRREVERSIBLE: the swap discards the scope-grained table this migration
-- replaces, and going back to it would restore the sibling-budget
-- double-count. Rollback statements stay commented out and must be applied
-- manually if ever needed.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
