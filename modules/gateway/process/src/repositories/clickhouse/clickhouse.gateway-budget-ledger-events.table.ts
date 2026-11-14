/**
 * `gateway_budget_ledger_events`, owned by gateway (goose 00017, 00059, 00070):
 * ReplacingMergeTree(EventTimestamp) over (TenantId, BudgetId, GatewayRequestId), by OccurredAt.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const gatewayBudgetLedgerEvents = defineClickHouseTable({
  name: "gateway_budget_ledger_events",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "EventTimestamp",
  sortKey: ["TenantId", "BudgetId", "GatewayRequestId"],
  columns: {
    TenantId: column.string(),
    BudgetId: column.string(),
    Scope: column.lowCardinalityString(),
    ScopeId: column.string(),
    Window: column.lowCardinalityString(),
    VirtualKeyId: column.string(),
    ProviderCredentialId: column.string(),
    GatewayRequestId: column.string(),
    AmountUSD: column.decimal({ precision: 18, scale: 6 }),
    TokensInput: column.uint32(),
    TokensOutput: column.uint32(),
    TokensCacheRead: column.uint32(),
    TokensCacheWrite: column.uint32(),
    Model: column.string(),
    ProviderSlot: column.lowCardinalityString(),
    DurationMS: column.uint32(),
    Status: column.lowCardinalityString(),
    OccurredAt: moment(),
    CreatedAt: moment(),
    EventTimestamp: column.uint64(),
    ProviderKey: column.string(),
    AmountNanoUSD: column.int64(),
  },
});
