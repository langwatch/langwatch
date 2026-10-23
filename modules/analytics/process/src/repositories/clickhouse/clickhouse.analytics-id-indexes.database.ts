import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/** The id indexes Analytics fills (goose 00113; id-index plan §1). */
export const ANALYTICS_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({ source: "evaluation_analytics", key: ["EvaluationId"], time: "OccurredAt" }),
];
