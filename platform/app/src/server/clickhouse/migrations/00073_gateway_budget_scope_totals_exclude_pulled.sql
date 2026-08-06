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
-- Why this is a plain view swap and not 00069's rebuild-and-swap: that
-- migration had to repair aggregates that were already wrong. This one has
-- nothing to repair. `Scope = 'pulled'` is introduced by the same change set
-- that adds this filter, so at the instant this runs no pulled row exists in
-- the ledger and no pulled figure exists in the rollup. There is no backfill
-- because there is no history. A rebuild would re-derive the identical table
-- at the cost of a full re-read of the ledger.
--
-- The gap between DROP and CREATE is the one real cost, and it is bounded and
-- recoverable: debits inserted in that window land in the ledger (which is the
-- source of truth and is never wrong) but are not folded into the rollup, so
-- they under-report until re-derived. Run this the way 00064 and 00069 were
-- run — during a maintenance window — and if a debit is known to have landed
-- inside the gap, re-derive with 00069's reconciliation block, which computes
-- a per-key delta and clamps at zero.
--
-- Re-running the whole file converges: the view is dropped if present and
-- recreated with the same definition.
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
    -- one the reader computes, on any server. toStartOfWeek mode 1 is
    -- Monday, matching the reader's ISO week. Unchanged from 00069.
    multiIf(
        Window = 'MINUTE', toDateTime64(toStartOfMinute(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'HOUR',   toDateTime64(toStartOfHour(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'DAY',    toDateTime64(toStartOfDay(OccurredAt, 'UTC'), 3, 'UTC'),
        Window = 'WEEK',   toDateTime64(toStartOfWeek(OccurredAt, 1, 'UTC'), 3, 'UTC'),
        Window = 'MONTH',  toDateTime64(toStartOfMonth(OccurredAt, 'UTC'), 3, 'UTC'),
        -- TOTAL and anything unrecognised: one lifetime bucket.
                           toDateTime64(0, 3, 'UTC')
    ) AS PeriodStart,
    BudgetId,
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

-- +goose StatementBegin
-- DROP VIEW IF EXISTS ${CLICKHOUSE_DATABASE}.gateway_budget_scope_totals_mv;
-- +goose StatementEnd

-- +goose ENVSUB OFF
