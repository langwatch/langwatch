import type { EvaluatorRuntimeEngine } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";

/** An evaluator type's own override wins; everything else runs on the default engine. */
export function engineForEvaluator({
  evaluatorType,
  engine,
  engineOverrides,
}: {
  evaluatorType: string;
  engine: EvaluatorRuntimeEngine;
  engineOverrides: Readonly<Record<string, EvaluatorRuntimeEngine>>;
}): EvaluatorRuntimeEngine {
  return engineOverrides[evaluatorType] ?? engine;
}

/**
 * The handled-error code one Go runtime refusal becomes (codes in the Go
 * module's `contract/errors.go`). `unauthorized` and `tenant_missing` are our
 * own wiring faults, so they surface as an execution failure.
 */
export function handledCodeForRuntimeRefusal({
  code,
}: {
  code: string | undefined;
}):
  | "evaluator_not_found"
  | "evaluator_config_error"
  | "evaluator_input_too_large"
  | "evaluation_busy"
  | "evaluator_execution_error" {
  switch (code) {
    case "evaluator_not_found":
      return "evaluator_not_found";
    case "evaluator_settings_invalid":
      return "evaluator_config_error";
    case "evaluation_payload_too_large":
      return "evaluator_input_too_large";
    case "evaluation_busy":
      return "evaluation_busy";
    default:
      return "evaluator_execution_error";
  }
}

/** Whether a shadowed Go result reached the same verdict as Python's. */
export function isSameVerdict({
  python,
  go,
}: {
  python: SingleEvaluationResult;
  go: SingleEvaluationResult;
}): boolean {
  if (python.status !== "processed" || go.status !== "processed") {
    return python.status === go.status;
  }
  return (
    (python.score ?? undefined) === (go.score ?? undefined) &&
    (python.passed ?? undefined) === (go.passed ?? undefined) &&
    (python.label ?? undefined) === (go.label ?? undefined)
  );
}
