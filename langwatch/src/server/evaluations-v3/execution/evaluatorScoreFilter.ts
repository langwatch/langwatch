/**
 * EvaluatorScoreFilter - Determines which evaluators should have their scores stripped.
 *
 * Some evaluators only produce pass/fail results (0 or 1 score), making the score
 * meaningless for aggregation purposes. This utility identifies such evaluators
 * so their scores can be omitted from results.
 *
 * Criteria for stripping score:
 * 1. Evaluator has isGuardrail=true (guardrails are binary by nature)
 * 2. Evaluator is "langevals/exact_match" (always 0 or 1)
 * 3. Evaluator is "langevals/llm_answer_match" (always 0 or 1)
 */

import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";

/**
 * Evaluator types that should always have their scores stripped,
 * regardless of isGuardrail flag.
 */
const BINARY_ONLY_EVALUATORS: Set<string> = new Set([
  "langevals/exact_match",
  "langevals/llm_answer_match",
]);

/**
 * Checks if a specific evaluator type should have its score stripped.
 *
 * @param evaluatorType - The evaluator type (e.g., "langevals/exact_match")
 * @returns true if the score should be stripped, false otherwise
 */
export const shouldStripScore = (evaluatorType: string): boolean => {
  // Check if it's a binary-only evaluator
  if (BINARY_ONLY_EVALUATORS.has(evaluatorType)) {
    return true;
  }

  // Check if it's a known evaluator with isGuardrail=true
  if (evaluatorType in AVAILABLE_EVALUATORS) {
    const definition = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    if (definition?.isGuardrail) {
      return true;
    }
  }

  // Custom evaluators (custom/xxx) - don't strip by default
  // since we set isGuardrail=false for them in useAvailableEvaluators
  return false;
};

/**
 * Builds a set of evaluator IDs whose scores should be stripped.
 *
 * @param evaluators - Array of evaluator configurations
 * @returns Set of evaluator IDs that should have scores stripped
 */
export const buildStripScoreEvaluatorIds = (
  evaluators: Array<{ id: string; evaluatorType: string }>,
): Set<string> => {
  const stripScoreIds = new Set<string>();

  for (const evaluator of evaluators) {
    if (shouldStripScore(evaluator.evaluatorType)) {
      stripScoreIds.add(evaluator.id);
    }
  }

  return stripScoreIds;
};
