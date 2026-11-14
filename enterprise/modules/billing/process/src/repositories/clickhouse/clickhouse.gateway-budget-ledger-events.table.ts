// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Gateway's `gateway_budget_ledger_events` (goose 00017, 00059, 00070) as billing's declared share
 * reads it: only the columns billing reads. ReplacingMergeTree(EventTimestamp) over (TenantId, BudgetId, GatewayRequestId).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const gatewayBudgetLedgerEvents = defineClickHouseTable({
  name: "gateway_budget_ledger_events",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "EventTimestamp",
  sortKey: ["TenantId", "BudgetId", "GatewayRequestId"],
  columns: {
    TenantId: column.string(),
    BudgetId: column.string(),
    ScopeId: column.string(),
    GatewayRequestId: column.string(),
    Status: column.lowCardinalityString(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    EventTimestamp: column.uint64(),
    AmountNanoUSD: column.int64(),
  },
});
