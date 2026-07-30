import type { Metrics, ReplaceStore } from "@langwatch/event-sourcing";
import { createFoldExecutor } from "@langwatch/event-sourcing";
import { type EvaluationState, evaluationAggregate } from "../aggregate";

export const EVALUATION_ANALYTICS_PROJECTION_NAME = "evaluationAnalytics";

/**
 * Wires the `evaluationAnalytics` fold executor (ADR-098) over a
 * `ReplaceStore<EvaluationState>` — normally the one `evaluationAnalytics.store.ts`
 * builds against `evaluationAnalyticsTable`, injected here rather than
 * constructed inline so a test can supply an in-memory double (see
 * `evaluationAnalytics.fold.unit.test.ts`, which exercises the real defect-#2
 * regression through this executor end-to-end, not just through the
 * aggregate's own `apply`).
 *
 * `init`/`apply`/`stateVersion` all come directly off `evaluationAggregate` —
 * there is no separate fold-specific copy of any of them. The version this
 * fold stamps and gates on IS the aggregate's own derived `stateVersion`
 * (ADR-105 §4: a hash of the state schema), so a shape change to
 * `evaluationStateSchema` moves this fold's version automatically.
 */
export function createEvaluationAnalyticsFoldExecutor(deps: {
  store: ReplaceStore<EvaluationState>;
  metrics?: Metrics;
}) {
  return createFoldExecutor({
    store: deps.store,
    init: evaluationAggregate.init,
    apply: evaluationAggregate.apply,
    stateVersion: evaluationAggregate.stateVersion,
    projectionName: EVALUATION_ANALYTICS_PROJECTION_NAME,
    metrics: deps.metrics,
  });
}
