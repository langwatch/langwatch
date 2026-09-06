-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_scope_totals_mv: bucket spend by the budget's own window.
--
-- The rollup is the only place budget spend is read from: the budgets list,
-- the budget detail page, /budget/check, and the /config/:vk_id bundle the
-- gateway enforces from all resolve spend as
--
--     sumMerge(SpendUSD) WHERE Window = ? AND PeriodStart = ?
--
-- where PeriodStart is computed application-side (currentPeriodStart in
-- budget.clickhouse.repository.ts). A row is therefore only ever readable if
-- this view buckets it into exactly the period the reader asks for.
--
-- The original expression only had branches for DAY, WEEK and MONTH, and
-- fell through to start-of-day for everything else, while the reader asked
-- for epoch on MINUTE/HOUR/TOTAL and for an ISO (Monday) week start on WEEK
-- against a toStartOfWeek() that defaults to Sunday. Four of the six windows
-- a budget can be created with therefore wrote into a bucket nothing ever
-- read: spend accrued, every read returned 0, and a blocking budget never
-- blocked and never warned no matter how much traffic ran through it.
--
-- Each window now buckets by its own period, and TOTAL collapses to the
-- epoch sentinel so a lifetime budget sums into a single bucket instead of
-- being silently reset every midnight. These match currentPeriodStart()
-- branch for branch; the two are pinned together by
-- budget.clickhouse.repository.periodStart.integration.test.ts.
--
-- Rows written before this migration keep their old PeriodStart. No read
-- regresses: on the four broken windows those rows were already unreadable,
-- and DAY/MONTH bucketing is unchanged.
-- ============================================================================

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
    -- All branches must return DateTime64(3) to match the target column.
    -- toStartOfWeek/toStartOfMonth return Date; toStartOfDay on DateTime64
    -- returns DateTime64 in newer CH versions. toDateTime64 on every branch
    -- normalises to a single precision for AggregatingMergeTree.
    --
    -- toStartOfWeek mode 1 is Monday, matching the ISO week the reader
    -- computes. The default (mode 0) is Sunday and never lines up with it.
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt), 3),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt),   3),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt),    3),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1), 3),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt),  3),
        -- TOTAL and anything unrecognised: one lifetime bucket.
                           toDateTime64(0, 3)
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

-- +goose ENVSUB OFF
