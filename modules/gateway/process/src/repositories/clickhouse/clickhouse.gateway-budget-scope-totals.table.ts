/**
 * `gateway_budget_scope_totals`, owned by gateway (goose 00017, 00058, 00064, 00069, 00070,
 * 00088): AggregatingMergeTree over (TenantId, Scope, ScopeId, Window, PeriodStart, BudgetId).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });
const summed = (of: Parameters<typeof column.simpleAggregate>[0]["of"]) =>
  column.aggregateFunction({ fn: "sum", args: [of] });

export const gatewayBudgetScopeTotals = defineClickHouseTable({
  name: "gateway_budget_scope_totals",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "Scope", "ScopeId", "Window", "PeriodStart", "BudgetId"],
  columns: {
    TenantId: column.string(),
    Scope: column.lowCardinalityString(),
    ScopeId: column.string(),
    Window: column.lowCardinalityString(),
    PeriodStart: moment(),
    BudgetId: column.string(),
    SpendUSD: summed(column.decimal({ precision: 18, scale: 6 })),
    TokensInput: summed(column.uint64()),
    TokensOutput: summed(column.uint64()),
    TokensCacheRead: summed(column.uint64()),
    TokensCacheWrite: summed(column.uint64()),
    RequestCount: column.aggregateFunction({ fn: "count", args: [column.uint64()] }),
    UpdatedAt: column.simpleAggregate({ fn: "max", of: moment() }),
    SpendNanoUSD: summed(column.int64()),
  },
});
