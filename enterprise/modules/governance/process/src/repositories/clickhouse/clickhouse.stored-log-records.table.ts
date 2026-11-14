// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `stored_log_records`, a legacy table (clickhouse-table-ownership.ts) governance reads for a
 * source's pushed log events (goose 00002). Only the columns the activity monitor reads, plus
 * the sort key: ReplacingMergeTree(UpdatedAt) over (TenantId, TraceId, SpanId, ProjectionId).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const storedLogRecords = defineClickHouseTable({
  name: "stored_log_records",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId", "ProjectionId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    Attributes: column.map({ key: column.lowCardinalityString(), value: column.string() }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
