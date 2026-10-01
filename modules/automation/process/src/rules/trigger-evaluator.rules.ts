import type {
  EvaluationSkipCode,
  GraphTriggerEvaluationCondition,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";

/** A result that stops the evaluation before it reads any data. */
export function skippedGraphEvaluation(input: {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  detail: string;
  skipCode: EvaluationSkipCode;
  condition?: GraphTriggerEvaluationCondition;
}): GraphTriggerEvaluationResult {
  return { ...input, status: "skipped" };
}
