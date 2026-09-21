-- +goose Up
-- +goose ENVSUB ON

-- ============================================================================
-- Keep pulled provider cost out of the budget spend rollup (ADR-088).
--
-- ADR-088 writes cost the customer already spent DIRECTLY with a provider into
-- gateway_budget_ledger_events under a constant Scope = 'pulled' with a
-- synthetic BudgetId. That money was spent outside our gateway. It cannot be
-- blocked, it was never admitted by us, and it must never enter a figure that
-- an enforcement decision reads.
--
-- Two mechanisms keep it out, and this migration is the second of them:
--
--   1. Structural, at resolution time. 'pulled' is not a
--      GatewayBudgetScopeType, so no GatewayBudget can carry it, and every
--      enforcement path resolves real budget rows before summing. No resolver
--      can name a target these rows match.
--   2. Structural, at fold time — here. The rollup's materialised view filters
--      on `Status = 'success'`, and pulled rows ARE successes: they are spend
--      that already happened, not attempts. So the existing filter admits
--      them, and the view has to name the scope explicitly to refuse them.
--
-- Belt and braces on purpose. (1) alone would be enough only for as long as
-- nobody adds a rollup read that groups by scope without naming a budget, and
-- "as long as nobody" is not a property of a system that moves money. With (2)
-- the aggregate never contains a pulled figure at all, so such a read finds
-- nothing to leak.
--
-- Why this is not 00069's rebuild-and-swap: that migration had to repair
-- aggregates that were already wrong. This one has nothing to repair.
-- `Scope = 'pulled'` is introduced by the same change set that adds this
-- filter, so at the instant this runs no pulled row exists in the ledger and
-- no pulled figure exists in the rollup. There is no backfill because there is
-- no history. A rebuild would re-derive the identical table at the cost of a
-- full re-read of the ledger.
--
-- Why this is `MODIFY QUERY` and not the `DROP` + `CREATE` the other view
-- migrations use: a materialised view is an insert trigger, so between a DROP
-- and the following CREATE there is no trigger at all. ClickHouse does not
-- replay the inserts made in that window, and this migration has no delta
-- replay, so every successful non-pulled debit landing in the gap would be
-- absent from the rollup permanently. The ledger would still hold it — that is
-- the source of truth and is never wrong — but `getSpendForBudgets*` sums the
-- rollup, so the gap under-reports spend, and under-reported spend is a budget
-- that authorises a request it should have refused. A maintenance-window
-- convention does not make that safe; it only makes it unlikely. `MODIFY
-- QUERY` swaps the SELECT atomically, with the trigger never absent, so there
-- is no window to reconcile and no procedure to remember.
--
-- Re-running the whole file converges: setting the same query twice is a no-op.
-- It does require the view to already exist, which ordered migrations
-- guarantee — 00070 creates it, and on a missing view this fails loudly with
-- UNKNOWN_TABLE rather than silently doing nothing.
--
-- The view body below is 00070's CURRENT definition with exactly one line
-- added (`AND Scope != 'pulled'`). Copy the latest migration that touched this
-- view, never the one whose comment reads best: an earlier draft of this file
-- was based on 00069, which predates the nano-USD column, and dropping
-- `sumState(AmountNanoUSD)` would have turned every calendar-window budget
-- into a silent no-op in production.
-- ============================================================================

-- +goose StatementBegin
ALTER TABLE ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv
MODIFY QUERY
SELECT
    TenantId,
    Scope,
    ScopeId,
    Window,
    -- All branches must return DateTime64(3) to match the target column,
    -- and every function names 'UTC' so the boundary truncated to is the
    -- one the reader computes, on any server. toStartOfWeek mode 1 is
    -- Monday, matching the reader's ISO week. Verbatim from 00070.
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
    -- THE money column. `getSpendForBudgets*` reads `sumMerge(SpendNanoUSD)`
    -- and nothing else, so a view that omits this writes an empty aggregate
    -- and every calendar-window budget silently reads zero and stops
    -- enforcing. Added by 00070; an earlier draft of this migration was
    -- based on 00069's pre-nano view and dropped it. `SpendUSD` below is the
    -- Decimal audit column and is never what enforcement sums, so a test
    -- asserting on it cannot see this class of break.
    sumState(AmountNanoUSD) AS SpendNanoUSD,
    sumState(AmountUSD) AS SpendUSD,
    sumState(toUInt64(TokensInput)) AS TokensInput,
    sumState(toUInt64(TokensOutput)) AS TokensOutput,
    sumState(toUInt64(TokensCacheRead)) AS TokensCacheRead,
    sumState(toUInt64(TokensCacheWrite)) AS TokensCacheWrite,
    countState() AS RequestCount
FROM ${CLICKHOUSE_DATABASE}.gateway_budget_ledger_events
WHERE Status = 'success'
  -- The whole point of this migration. Pulled rows are successes, so the
  -- status filter above admits them; money spent outside the gateway must
  -- never reach a total an enforcement decision can read.
  AND Scope != 'pulled'
GROUP BY TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId;
-- +goose StatementEnd

-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON

-- IRREVERSIBLE in the sense that matters: restoring the previous definition
-- would let pulled provider cost fold into budget totals, and a budget would
-- then enforce against money spent outside the gateway. Rollback statements
-- stay commented out and must be applied deliberately, by hand.
--
-- The inverse is 00070's query, not a DROP. Dropping the view would remove the
-- trigger outright and stop folding every scope, which is a larger outage than
-- the one being rolled back; re-run 00070 to restore its SELECT atomically.

-- +goose StatementBegin
-- Re-run 00070 to restore its view definition.
-- +goose StatementEnd

-- +goose ENVSUB OFF
