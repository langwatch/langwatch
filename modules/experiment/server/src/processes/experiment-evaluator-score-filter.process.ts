/**
 * Determines which evaluators produce only binary scores (0 or 1) and should have their scores
 * omitted from results. Strips scores for guardrails and specific binary-only evaluators.
 */

import { AVAILABLE_EVALUATORS, type EvaluatorTypes } from "@langwatch/evaluator-contract";

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
  evaluators: { id: string; evaluatorType: string }[],
): Set<string> => {
  const stripScoreIds = new Set<string>();

  for (const evaluator of evaluators) {
    if (shouldStripScore(evaluator.evaluatorType)) {
      stripScoreIds.add(evaluator.id);
    }
  }

  return stripScoreIds;
};
