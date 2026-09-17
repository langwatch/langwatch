/**
 * Builds EvaluatorApp collaborators; NLP dispatcher is a structural type to
 * avoid module dependencies. The workflow-graph reads and writes themselves
 * live in `repositories/prisma/prisma.evaluator-graph.repository.ts`.
 */
import type { EvaluatorNlpDispatcher } from "../services/evaluator-code-execution.service.ts";

/**
 * Refuses by name rather than crashing on `undefined`: no deployment supplies
 * this module an NLP dispatcher yet (its builder died with the deleted
 * composition and nothing replaced it), so the one capability that needs it —
 * running a code evaluator — fails with an attributable error instead of a
 * silent `TypeError` the first time a customer runs one.
 */
export function refusingEvaluatorNlpDispatcher(): EvaluatorNlpDispatcher {
  return {
    dispatch() {
      return Promise.reject(
        new Error(
          "This deployment did not supply the evaluator module an NLP runtime, so a code evaluator cannot run",
        ),
      );
    },
  };
}
