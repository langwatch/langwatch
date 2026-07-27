-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_scope_totals_mv: truncate periods in UTC, explicitly.
--
-- The ledger's OccurredAt is a bare DateTime64(3), so every toStartOf*
-- call in the previous view definition (00055) truncated in whatever
-- timezone the ClickHouse server happens to run in. The reader
-- (currentPeriodStart in budget.clickhouse.repository.ts) always computes
-- period starts in UTC. On a server whose default timezone is not UTC,
-- DAY, WEEK, and MONTH debits therefore land at local midnight while the
-- reader asks for UTC midnight: the same never-readable-bucket failure
-- 00055 fixed for window drift, reachable again through deployment
-- configuration. MINUTE survives any timezone, HOUR survives whole-hour
-- offsets only (a half-hour zone breaks it), and TOTAL is the epoch
-- sentinel; every branch is pinned for uniformity.
--
-- The test environment runs ClickHouse in UTC, which is why the 00055
-- parity test could never see this. The regression test simulates a
-- non-UTC server by setting session_timezone on a synchronous insert,
-- which is the context the view's SELECT evaluates in.
--
-- Rows written before this migration keep their old PeriodStart. On a
-- UTC server nothing changes. On a non-UTC server the affected windows
-- were unreadable anyway, exactly as in 00055's rollout.
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

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- Down migrations are intentionally commented out to prevent accidental data loss.
-- To roll back, uncomment below and run manually.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
