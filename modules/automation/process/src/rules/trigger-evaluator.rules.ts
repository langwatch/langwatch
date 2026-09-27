import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";

/** A result that stops the evaluation before it reads any data. */
export function skippedGraphEvaluation(input: {
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
  detail: string;
}): GraphTriggerEvaluationResult {
  return { ...input, status: "skipped" };
}
