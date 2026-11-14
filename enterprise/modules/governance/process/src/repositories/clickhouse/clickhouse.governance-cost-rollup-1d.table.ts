// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_cost_rollup_1d`, owned by governance (goose 00092, 00093, 00095):
 * ReplacingMergeTree(EventTimestamp) over the cell key, partitioned by Day.
 * No `timeColumn`: the builder admits only the fence's time-column names, and Day is not one.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const governanceCostRollup1d = defineClickHouseTable({
  name: "governance_cost_rollup_1d",
  tenantColumn: "TenantId",
  versionColumn: "EventTimestamp",
  sortKey: [
    "TenantId",
    "Day",
    "CostSource",
    "IngestionSourceId",
    "Provider",
    "Model",
    "AgentId",
    "CurrencyCode",
    "RawActorId",
  ],
  columns: {
    TenantId: column.string(),
    Day: column.date(),
    CostSource: column.lowCardinalityString(),
    IngestionSourceId: column.string(),
    Provider: column.lowCardinalityString(),
    Model: column.lowCardinalityString(),
    AgentId: column.string(),
    CurrencyCode: column.lowCardinalityString(),
    RawActorId: column.string(),
    OrganizationId: column.string(),
    ExactOrEstimate: column.lowCardinalityString(),
    AmountNanoUsd: column.nullable(column.int64()),
    AmountNanoMinor: column.int64(),
    TokensInput: column.uint64(),
    TokensOutput: column.uint64(),
    TokensCacheRead: column.uint64(),
    TokensCacheWrite: column.uint64(),
    RequestCount: column.uint64(),
    RevisionCount: column.uint32(),
    PreviousAmountNanoUsd: column.nullable(column.int64()),
    PulledItemsJson: column.string(),
    Version: column.lowCardinalityString(),
    AppliedEventIds: column.stringArray(),
    CreatedAt: column.uint64(),
    LastEventOccurredAt: column.uint64(),
    EventTimestamp: column.uint64(),
    RevisedAt: column.nullable(column.dateTime()),
    LastObservedAt: column.dateTime(),
  },
});
