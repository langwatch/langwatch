-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Budget money becomes the integer it always claimed to be: nano-USD.
--
-- A request is priced exactly once, at the ingest seam that mints the spend
-- command, as an integer `cost_nano_usd`. The spend-events projection copies
-- that integer verbatim into `gateway_spend.CostNanoUSD Int64`. The budget
-- ledger did not: it divided the integer by 1e9 in float64 and stored six
-- decimals, so every debit was rounded to the nearest micro-USD BEFORE it was
-- ever summed, and `AmountUSD Decimal(18, 6)` could not have held more.
--
-- Rounding each debit and then summing is not the same number as summing and
-- then rounding, and the gap grows with request count rather than cancelling:
-- a budget on live data read 219000 nano against a true 212250, and one whose
-- requests were small enough read 100000 against a true 55050. The REST
-- surface publishes that figure as `spent_nano_usd` and calls it "the
-- canonical integer in the same nano-USD unit the spend events carry", so a
-- caller reconciling a budget against its own spend events found they did not
-- agree, by up to 81%.
--
-- `AmountNanoUSD` is now the money column. `AmountUSD` stays for the audit
-- read that shows a single debit next to the request that caused it, and is
-- no longer summed anywhere.
--
-- Statement order, and why each step is safe:
--
--   1. Both ADD COLUMNs are metadata-only. Existing parts are not rewritten;
--      the ledger's DEFAULT computes on read, so history reads as the micro
--      figure it has always been, expressed in nano.
--   2. The rollup's new aggregate reads as an empty state on every existing
--      part, which merges to 0. That is why step 4 exists.
--   3. The view is dropped and recreated at the wider grain. Debits inserted
--      while no view exists land in the ledger only, losing nothing.
--   4. Reconciliation, 00069's argument verbatim: the ledger is re-aggregated
--      into a scratch snapshot and a delta insert adds, per rollup key,
--      exactly the amount present in the ledger but not yet in the rollup.
--      This doubles as the nano backfill, because every pre-existing key
--      holds 0 nano and so takes its whole true total here. A debit that
--      landed during the view gap is added exactly once; one the recreated
--      view already folded contributes a zero delta. Deltas clamp at zero.
--
-- Re-running the file converges to the same state: the scratch table is
-- dropped and recreated rather than truncated, and the delta re-derives.
--
-- Backfilled nano is the micro figure scaled up, not recovered precision:
-- the digits were destroyed at write and no longer exist anywhere in this
-- table. Requests priced after this migration carry the true integer. The
-- exact per-request history remains readable in `gateway_spend.CostNanoUSD`.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
    ADD COLUMN IF NOT EXISTS AmountNanoUSD Int64
        DEFAULT toInt64(AmountUSD * 1000000) * 1000
        CODEC(ZSTD(1));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    ADD COLUMN IF NOT EXISTS SpendNanoUSD AggregateFunction(sum, Int64);
-- +goose StatementEnd

-- +goose StatementBegin
DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
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
    -- Grouping by the budget keeps the aggregate at the ledger's own grain;
    -- without it two budgets on one bucket fold into a single aggregate
    -- holding both their rows. See 00069.
    BudgetId,
    sumState(AmountNanoUSD) AS SpendNanoUSD,
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
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_nano_recon;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_nano_recon
(
    TenantId String CODEC(ZSTD(1)),
    Scope LowCardinality(String),
    ScopeId String CODEC(ZSTD(1)),
    Window LowCardinality(String),
    PeriodStart DateTime64(3) CODEC(Delta(8), ZSTD(1)),
    BudgetId String CODEC(ZSTD(1)),

    TrueSpendNanoUSD Int64,
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
INSERT INTO ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_nano_recon
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
    sum(AmountNanoUSD) AS TrueSpendNanoUSD,
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
    (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId, SpendNanoUSD, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount)
SELECT
    r.TenantId,
    r.Scope,
    r.ScopeId,
    r.Window,
    r.PeriodStart,
    r.BudgetId,
    arrayReduce('sumState', [toInt64(greatest(r.TrueSpendNanoUSD - c.CurSpendNanoUSD, 0))]),
    arrayReduce('sumState', [toDecimal64(greatest(r.TrueSpendUSD - c.CurSpendUSD, 0), 6)]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensInput) - toInt64(c.CurTokensInput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensOutput) - toInt64(c.CurTokensOutput), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheRead) - toInt64(c.CurTokensCacheRead), 0))]),
    arrayReduce('sumState', [toUInt64(greatest(toInt64(r.TrueTokensCacheWrite) - toInt64(c.CurTokensCacheWrite), 0))]),
    arrayReduce('countState', range(toUInt64(greatest(toInt64(r.TrueRequestCount) - toInt64(c.CurRequestCount), 0))))
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_nano_recon AS r
LEFT JOIN (
    SELECT
        TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId,
        sumMerge(SpendNanoUSD) AS CurSpendNanoUSD,
        sumMerge(SpendUSD) AS CurSpendUSD,
        sumMerge(TokensInput) AS CurTokensInput,
        sumMerge(TokensOutput) AS CurTokensOutput,
        sumMerge(TokensCacheRead) AS CurTokensCacheRead,
        sumMerge(TokensCacheWrite) AS CurTokensCacheWrite,
        countMerge(RequestCount) AS CurRequestCount
    FROM ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals
    GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId
) AS c USING (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId)
WHERE r.TrueSpendNanoUSD > c.CurSpendNanoUSD
   OR r.TrueSpendUSD > c.CurSpendUSD
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
DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_nano_recon;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- IRREVERSIBLE: dropping the nano aggregate discards the only exact record
-- of what each budget spent after this migration, and the decimal column it
-- would fall back to cannot represent those amounts. To roll back, uncomment
-- and run manually, accepting that the rollup returns to micro-USD grain.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
