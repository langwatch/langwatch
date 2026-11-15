import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Langy's analytics rows (goose 00047), as far as langy reads them: the sort key and the stored
 * size the storage meter sums.
 */
export const langyAnalyticsEvents = defineClickHouseTable({
  name: "langy_analytics_events",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "OccurredAt", "EventId"],
  columns: {
    TenantId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    EventId: column.string(),
    _size_bytes: column.uint32(),
  },
});
