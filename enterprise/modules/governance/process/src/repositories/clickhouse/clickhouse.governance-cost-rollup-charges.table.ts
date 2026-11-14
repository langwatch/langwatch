// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_cost_rollup_charges`, owned by governance (goose 00102):
 * ReplacingMergeTree(EventOccurredAt) over (TenantId, Day, EventId), partitioned by Day.
 * No `timeColumn`: the builder admits only the fence's time-column names, and Day is not one.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const governanceCostRollupCharges = defineClickHouseTable({
  name: "governance_cost_rollup_charges",
  tenantColumn: "TenantId",
  versionColumn: "EventOccurredAt",
  sortKey: ["TenantId", "Day", "EventId"],
  columns: {
    TenantId: column.string(),
    Day: column.date(),
    EventId: column.string(),
    CostSource: column.lowCardinalityString(),
    IngestionSourceId: column.string(),
    Provider: column.lowCardinalityString(),
    Model: column.lowCardinalityString(),
    AgentId: column.string(),
    CurrencyCode: column.lowCardinalityString(),
    RawActorId: column.string(),
    RestatementKey: column.string(),
    IsRetraction: column.uint8(),
    ObservedAtMs: column.int64(),
    AmountNanoMinor: column.int64(),
    EventOccurredAt: column.uint64(),
  },
});
