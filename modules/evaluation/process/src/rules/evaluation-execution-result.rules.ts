import type { EvaluationExecutionResult } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";

/**
 * One evaluator answer as the caller reads it: an error carries its detail as `error` and its
 * traceback as `errorDetails`, a processed one carries score, verdict, label and cost.
 */
export function executionResultOf({
  result,
  evaluationThreadId,
  inputs,
}: {
  result: SingleEvaluationResult;
  evaluationThreadId: string | undefined;
  inputs: Record<string, unknown>;
}): EvaluationExecutionResult {
  const isError = result.status === "error";
  const rawDetails = "details" in result ? result.details : undefined;
  const traceback =
    isError && "traceback" in result && Array.isArray(result.traceback)
      ? result.traceback.join("\n")
      : undefined;

  return {
    status: result.status,
    score: result.status === "processed" ? result.score : undefined,
    passed: result.status === "processed" ? result.passed : undefined,
    label: result.status === "processed" ? result.label : undefined,
    details: isError ? undefined : rawDetails,
    error: isError ? (rawDetails ?? "Evaluator failed") : undefined,
    errorDetails: traceback,
    cost:
      result.status === "processed" && "cost" in result && result.cost ? result.cost : undefined,
    evaluationThreadId,
    inputs,
  };
}
