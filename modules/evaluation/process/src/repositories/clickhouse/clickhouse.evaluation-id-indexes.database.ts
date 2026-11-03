import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/**
 * The id indexes Evaluation fills (goose 00112; id-index plan §1). `evaluation_runs` expires on
 * `UpdatedAt`, not on its partition column `ScheduledAt`, so the index retains on `UpdatedAt`.
 */
export const EVALUATION_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({
    source: "evaluation_runs",
    key: ["EvaluationId"],
    time: "ScheduledAt",
    retentionAnchor: "UpdatedAt",
  }),
];

/** The second index goose `00121` creates (by trace id), filled by its own step. */
export const EVALUATION_SECOND_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({
    source: "evaluation_runs",
    key: ["TraceId"],
    time: "ScheduledAt",
    retentionAnchor: "UpdatedAt",
    filter: "TraceId IS NOT NULL AND TraceId != ''",
    by: true,
  }),
];
