// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_cost_rollup_restatement_index`, owned by governance (goose 00094, 00095):
 * ReplacingMergeTree(EventTimestamp) over (TenantId, RestatementKey), unpartitioned.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const governanceCostRollupRestatementIndex = defineClickHouseTable({
  name: "governance_cost_rollup_restatement_index",
  tenantColumn: "TenantId",
  versionColumn: "EventTimestamp",
  sortKey: ["TenantId", "RestatementKey"],
  columns: {
    TenantId: column.string(),
    RestatementKey: column.string(),
    Day: column.date(),
    CostSource: column.lowCardinalityString(),
    IngestionSourceId: column.string(),
    Provider: column.lowCardinalityString(),
    Model: column.lowCardinalityString(),
    AgentId: column.string(),
    CurrencyCode: column.lowCardinalityString(),
    RawActorId: column.string(),
    EventTimestamp: column.uint64(),
  },
});
