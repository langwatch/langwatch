import type { TraceEvaluationData } from "@langwatch/evaluation-contract";
import type { Evaluation } from "@langwatch/trace-contract";

/** A run as the trace's `evaluations` carry it, the shape field mappings read from. */
export function traceEvaluationOf({ evaluation }: { evaluation: TraceEvaluationData }): Evaluation {
  return {
    evaluation_id: evaluation.evaluationId,
    evaluator_id: evaluation.evaluatorId,
    name: evaluation.evaluatorName ?? "",
    type: evaluation.evaluatorType,
    is_guardrail: evaluation.isGuardrail,
    status: evaluation.status,
    passed: evaluation.passed,
    score: evaluation.score,
    label: evaluation.label,
    details: evaluation.details,
    error: evaluation.error
      ? { has_error: true as const, message: evaluation.error, stacktrace: [] }
      : null,
    inputs: evaluation.inputs,
    timestamps: {
      inserted_at: evaluation.timestamps.scheduledAt,
      started_at: evaluation.timestamps.startedAt,
      finished_at: evaluation.timestamps.completedAt,
    },
  };
}
