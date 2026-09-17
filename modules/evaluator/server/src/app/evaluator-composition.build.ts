/**
 * Builds EvaluatorApp collaborators; NLP dispatcher is a structural type to
 * avoid module dependencies. The workflow-graph reads and writes themselves
 * live in `repositories/prisma/prisma.evaluator-graph.repository.ts`.
 */
import type { EvaluatorNlpDispatcher } from "../services/evaluator-code-execution.service.ts";

/** Refuses by name when no deployment supplies this module an NLP dispatcher. */
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
