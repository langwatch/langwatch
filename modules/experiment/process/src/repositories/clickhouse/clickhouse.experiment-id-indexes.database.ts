import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/**
 * The id indexes goose `00114` creates, in the order the fill visits them. Each source carries
 * its row's `_retention_days` and expires on its partition column, so the fill copies the one
 * and needs no `RetainAt`.
 */
export const EXPERIMENT_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "experiment_runs", key: ["RunId"], time: "StartedAt" }),
  defineIdIndex({ source: "dspy_steps", key: ["ExperimentId", "RunId"], time: "CreatedAt" }),
];

/**
 * The second index goose `00119` creates, filled by its own step so a finished first fill never
 * skips it.
 */
export const EXPERIMENT_SECOND_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "experiment_runs", key: ["ExperimentId"], time: "StartedAt", by: true }),
];
