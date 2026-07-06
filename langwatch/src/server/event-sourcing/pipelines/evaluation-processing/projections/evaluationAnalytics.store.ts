import type { EvaluationAnalyticsRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics.repository";
import { BaseAnalyticsFoldStore } from "../../shared/analyticsStoreBase";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
  projectEvaluationAnalyticsStateToRow,
} from "./evaluationAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `evaluation_analytics` fold
 * (ADR-034 Phase 6 — eval mirror of `TraceAnalyticsStore`).
 *
 * Skips empty rows (no terminal status seen yet, evaluationId still ''),
 * falls back to the aggregateId when the state has no evaluationId, stamps
 * the per-tenant retention onto the record, and projects the in-memory
 * `EvaluationAnalyticsData` accumulator into the slim row at write time.
 *
 * The slim row is derived deterministically from a fold state whose
 * handlers mirror the `EvaluationRunFoldProjection` for the shared fields,
 * so the persisted hoisted-dim columns (Status / Score / Passed / Label /
 * EvaluatorType / TraceId / IsGuardrail) match `evaluation_runs` to the
 * cent for the SAME evaluation. The slim Attributes map is trimmed by
 * `trimAttributesForAnalytics` inside the projection function so
 * payload-shaped keys never reach the wire.
 */
export class EvaluationAnalyticsStore extends BaseAnalyticsFoldStore<
  EvaluationAnalyticsData,
  ReturnType<typeof projectEvaluationAnalyticsStateToRow>
> {
  constructor(repo: EvaluationAnalyticsRepository) {
    super(repo, {
      hasPersistableSignal,
      stampAggregateId: (state, aggregateId) =>
        state.evaluationId ? state : { ...state, evaluationId: aggregateId },
      retentionCategory: "traces",
      versionLatest: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
      project: projectEvaluationAnalyticsStateToRow,
    });
  }
}

/**
 * Skip rows that have no observable signal yet — the fold may have run
 * once with a half-formed scheduled-only state. Persisting it would churn
 * the slim table for evaluations that never reach a terminal status.
 *
 * "Signal" = at least one of: terminal status reached, identity stamped
 * via `EvaluationReportedEvent` (which sets evaluatorType on its own), or
 * a non-empty evaluatorId from any earlier event. The conservative branch
 * (no evaluationId) is always a no-op so the store cannot persist a row
 * whose primary key is empty.
 */
function hasPersistableSignal(state: EvaluationAnalyticsData): boolean {
  if (!state.evaluationId && !state.evaluatorId) return false;
  return true;
}
