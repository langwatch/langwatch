import { defineFoldProjection } from "@langwatch/event-sourcing";
import {
  applyEvaluationReported,
  applyEvaluationStarted,
  evaluation,
} from "./aggregate";

/**
 * `evaluation_analytics` — one row per evaluation. Its state is the
 * aggregate's, so the handlers are the aggregate's own applies rather than a
 * second copy of them.
 */
export const evaluationAnalytics = defineFoldProjection({
  name: "evaluationAnalytics",
  aggregate: evaluation,
  version: evaluation.stateVersion,
  init: evaluation.init,
  handle: {
    started: applyEvaluationStarted,
    reported: applyEvaluationReported,
  },
});
