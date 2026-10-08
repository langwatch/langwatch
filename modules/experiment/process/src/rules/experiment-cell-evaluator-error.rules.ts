import type { EvaluationV3Event } from "@langwatch/experiment-contract";

/** An evaluator's error stays an evaluator's (ARCHITECTURE §9), as evaluatorErrorResult has it. */
export function keptAsEvaluatorError(event: EvaluationV3Event): EvaluationV3Event {
  if (event.type !== "error" || !event.evaluatorId) return event;
  if (event.rowIndex === undefined || !event.targetId) return event;

  return {
    type: "evaluator_result",
    rowIndex: event.rowIndex,
    targetId: event.targetId,
    evaluatorId: event.evaluatorId,
    result: {
      status: "error",
      error_type: "EvaluatorError",
      details: event.message,
      traceback: [],
      ...(event.domainError ? { domainError: event.domainError } : {}),
    },
  };
}
