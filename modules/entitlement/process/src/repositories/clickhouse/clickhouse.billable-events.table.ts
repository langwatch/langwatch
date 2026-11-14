/** `billable_events`, owned by entitlement (goose 00002): ReplacingMergeTree(UpdatedAt). */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const billableEvents = defineClickHouseTable({
  name: "billable_events",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["OrganizationId", "TenantId", "DeduplicationKeyHash"],
  columns: {
    OrganizationId: column.string(),
    TenantId: column.string(),
    EventId: column.string(),
    EventType: column.lowCardinalityString(),
    DeduplicationKey: column.string(),
    DeduplicationKeyHash: column.uint64(),
    EventTimestamp: column.dateTime64({ precision: 3 }),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
