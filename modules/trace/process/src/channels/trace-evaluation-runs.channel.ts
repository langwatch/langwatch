import type { EvaluationApi } from "@langwatch/evaluation-contract";

/**
 * What trace asks evaluation for its outcomes: a run's identity, and pages of finished runs for
 * the backfill. Bound to evaluation's API, not a peer, since evaluation depends on trace (§5).
 */
export type TraceEvaluationRuns = Pick<
  EvaluationApi,
  "findRunByEvaluationId" | "listEvaluationOutcomes"
>;
