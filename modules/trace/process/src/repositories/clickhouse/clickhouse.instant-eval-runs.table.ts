import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Instant-eval's runs, a declared share trace reads (clickhouse-table-ownership.ts,
 * instant_eval_runs: owner instant-eval, reader trace). Only the columns trace's run dating
 * selects.
 */
export const instantEvalRuns = defineClickHouseTable({
  name: "instant_eval_runs",
  tenantColumn: "TenantId",
  versionColumn: "WrittenAt",
  sortKey: ["TenantId", "RunId"],
  columns: {
    TenantId: column.string(),
    RunId: column.string(),
    CreatedAt: column.dateTime64({ precision: 3 }),
    FinishedAt: column.nullable(column.dateTime64({ precision: 3 })),
    WrittenAt: column.dateTime64({ precision: 3 }),
    AcceptedAt: column.nullable(column.dateTime64({ precision: 3 })),
    LastEventId: column.string(),
  },
});
