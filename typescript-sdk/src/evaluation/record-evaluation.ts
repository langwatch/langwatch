import { EvaluationRESTResult } from "src/server/types/evaluations";
import * as intSemconv from "../observability/semconv";
import { getTracer } from "../observability/trace";
import { Attributes } from "@opentelemetry/api";
import { generate } from "xksuid";

const tracer = getTracer("langwatch.evaluation");

export interface EvaluationDetails {
  evaluationId?: string;
  name: string;
  type?: string;
  isGuardrail?: boolean;
  status?: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  label?: string;
  details?: string;
  cost?: number | { currency: string; amount: number };
  error?: Error;
  timestamps?: {
    startedAtUnixMs: number;
    finishedAtUnixMs: number;
  };
}

export function recordEvaluation(
  details: EvaluationDetails,
  attributes?: Attributes,
) {
  let result: EvaluationRESTResult;
  const status = details.status || "processed";

  if (status === "skipped") {
    result = {
      status: "skipped",
      details: details.details,
    };
  } else if (status === "error") {
    result = {
      status: "error",
      error_type: details.error?.name || "Unknown",
      details: details.details || details.error?.message || "Unknown error",
    };
  } else {
    result = {
      status: "processed",
      passed: details.passed,
      score: details.score,
      label: details.label,
      details: details.details,
    };
    if (details.cost) {
      (result as any).cost = typeof details.cost === "number"
        ? { currency: "USD", amount: details.cost }
        : details.cost;
    }
  }

  tracer.startActiveSpan("evaluation", (span) => {
    span.setType("evaluation");
    span.addEvent(intSemconv.ATTR_LANGWATCH_EVALUATION_CUSTOM, {
      json_encoded_event: JSON.stringify({
        evaluation_id: details.evaluationId ?? `eval_${generate()}`,
        name: details.name,
        type: details.type,
        is_guardrail: details.isGuardrail,
        status: result.status,
        passed: details.passed,
        score: details.score,
        label: details.label,
        details: details.details,
        cost: details.cost,
        error: details.error,
        timestamps: details.timestamps,
      }),
    });

    span.recordOutput(result);

    if (attributes) {
      span.setAttributes(attributes);
    }
    if (details.cost) {
      span.setMetrics({
        cost: typeof details.cost === "number" ? details.cost : details.cost.amount,
      });
    }

    span.end();
    return;
  });
}
