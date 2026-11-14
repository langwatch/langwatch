import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

/**
 * `instant_eval_runs`, owned by instant-eval (goose 00098; shared for reading with trace,
 * clickhouse-table-ownership): ReplacingMergeTree(WrittenAt) over (TenantId, RunId), no partition.
 */
export const instantEvalRuns = defineClickHouseTable({
  name: "instant_eval_runs",
  tenantColumn: "TenantId",
  versionColumn: "WrittenAt",
  sortKey: ["TenantId", "RunId"],
  columns: {
    TenantId: column.string(),
    RunId: column.string(),
    Name: column.nullable(column.string()),
    Sql: column.string(),
    Parameters: column.string(),
    Questions: column.string(),
    Plan: column.string(),
    RowLimit: column.uint32(),
    Status: column.lowCardinality(column.string()),
    Total: column.nullable(column.uint32()),
    Progress: column.uint32(),
    Matched: column.nullable(column.uint32()),
    MatchedByQuestion: column.string(),
    Failed: column.uint32(),
    Skipped: column.uint32(),
    Tokens: column.uint64(),
    CostUsd: column.float64(),
    PriceUsd: column.float64(),
    Error: column.nullable(column.string()),
    CreatedAt: moment(),
    UpdatedAt: moment(),
    StartedAt: column.nullable(moment()),
    FinishedAt: column.nullable(moment()),
    OccurredAt: column.nullable(moment()),
    AcceptedAt: column.nullable(moment()),
    LastEventId: column.string(),
    ProjectionVersion: column.string(),
    WrittenAt: moment(),
  },
});
