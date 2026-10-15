import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/**
 * The id index goose `00115` creates. `simulation_runs` expires on its partition column
 * `StartedAt` and carries `_retention_days`, so the fill copies the one and needs no `RetainAt`.
 */
export const SCENARIO_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "simulation_runs", key: ["ScenarioRunId"], time: "StartedAt" }),
];
