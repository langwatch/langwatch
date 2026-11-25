import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/**
 * The id index goose `00116` creates. `suite_runs` expires on its partition column `StartedAt`
 * and carries `_retention_days`, so the fill copies the one and needs no `RetainAt`.
 */
export const SUITE_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "suite_runs", key: ["BatchRunId"], time: "StartedAt" }),
];
