import type {
  EvaluatorService,
  SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
} from "~/server/metrics";

/** Process metrics around Evaluator-owned deterministic native execution. */
export async function executeNativeEvaluation(input: {
  evaluators: EvaluatorService;
  evaluatorType: string;
  data: Record<string, unknown>;
}): Promise<SingleEvaluationResult> {
  const start = performance.now();
  const result = await input.evaluators.executeNative(input);

  evaluationDurationHistogram
    .labels(input.evaluatorType)
    .observe(performance.now() - start);
  getEvaluationStatusCounter(input.evaluatorType, result.status).inc();
  return result;
}
