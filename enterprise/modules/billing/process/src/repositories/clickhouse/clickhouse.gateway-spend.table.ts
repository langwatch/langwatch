// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Gateway's `gateway_spend` (goose 00067, 00076, 00078, 00089, 00124) as billing's declared share
 * reads it: only the columns billing reads. ReplacingMergeTree(EventTimestamp) over (TenantId, GatewayRequestId).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const gatewaySpend = defineClickHouseTable({
  name: "gateway_spend",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "EventTimestamp",
  sortKey: ["TenantId", "GatewayRequestId"],
  columns: {
    TenantId: column.string(),
    GatewayRequestId: column.string(),
    RequestType: column.lowCardinalityString(),
    Status: column.lowCardinalityString(),
    CostNanoUSD: column.int64(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    EventTimestamp: column.uint64(),
  },
});
