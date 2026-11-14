/** `usage_trace_meter`, owned by entitlement (goose 00104): ReplacingMergeTree(UpdatedAt). */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const usageTraceMeter = defineClickHouseTable({
  name: "usage_trace_meter",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["OrganizationId", "Month", "TenantId", "TraceId"],
  columns: {
    OrganizationId: column.string(),
    TenantId: column.string(),
    Month: column.date(),
    TraceId: column.string(),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
