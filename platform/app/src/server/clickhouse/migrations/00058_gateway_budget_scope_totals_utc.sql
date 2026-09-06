-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- gateway_budget_scope_totals: truncate periods in UTC, and rebuild the
-- rollup from the ledger so every row is keyed by the UTC boundary.
--
-- The ledger's OccurredAt is a bare DateTime64(3), so an unpinned
-- toStartOf* truncates in whatever timezone the ClickHouse server runs
-- in, while the reader (currentPeriodStart in
-- budget.clickhouse.repository.ts) always computes period starts in UTC.
-- On a server whose default timezone is not UTC, DAY, WEEK, and MONTH
-- debits land at local midnight while every read asks for UTC midnight:
-- spend accrues, reads back as $0.00, and the budget never warns and
-- never blocks. Every branch below names 'UTC' twice: in the truncation
-- function, and in the outer toDateTime64, because toStartOfWeek and
-- toStartOfMonth return a Date whose conversion to DateTime64 would
-- otherwise re-interpret midnight in the server timezone.
--
-- PeriodStart is part of the rollup's key, so pinning the truncation
-- re-keys every DAY/WEEK/MONTH row a non-UTC server ever folded. The
-- rows already in the rollup are aggregate states that cannot be
-- re-keyed in place, so the rollup is rebuilt from
-- gateway_budget_ledger_events, which is the durable source of truth
-- (ReplacingMergeTree on (TenantId, BudgetId, GatewayRequestId); FINAL
-- collapses replays the same way the app-side dedup does). An org that
-- spent $800 of a $1000 monthly budget before this migration reads $800
-- after it, on any server timezone.
--
-- Why this statement order folds every debit exactly once:
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
-- Re-running this migration (the runner may re-apply a partially
-- executed file after a crash) is safe from any interruption point:
-- the scratch tables are created IF NOT EXISTS and truncated, the
-- rebuild always starts empty, the swap replaces whatever the previous
-- attempt left, and the reconciliation re-derives its delta from the
-- current ledger. Every complete run converges to the same state.
--
-- On a server that already runs in UTC the truncation output is
-- unchanged, so the rebuild reproduces the same totals and the swap is
-- a behavioral no-op; budget.clickhouse.repository.periodStart
-- .integration.test.ts asserts the read-back is identical.
--
-- Cost: two full scans of the ledger (rebuild and reconciliation), one
-- aggregation each, and an atomic table swap. This is the same work the
-- materialized view has done over the table's lifetime, compressed into
-- one migration.
-- ============================================================================

-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild
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

    UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(PeriodStart)
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
TRUNCATE TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_rebuild;
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
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon
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
ENGINE = MergeTree()
ORDER BY (TenantId, Scope, ScopeId, Window, PeriodStart)
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
-- +goose StatementEnd

-- +goose StatementBegin
TRUNCATE TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_recon;
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

-- IRREVERSIBLE: the rebuild re-keys the rollup's persisted aggregate rows
-- in place. Undoing it would mean another full rebuild under server-local
-- boundaries, which re-hides current-period spend from the UTC reader,
-- and the pre-rebuild aggregate rows no longer exist to restore. Rollback
-- statements stay commented out and must be applied manually if ever
-- needed.

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
