import { EvaluationRESTResult } from "src/server/types/evaluations";
import * as intSemconv from "../observability/semconv";
import { getTracer } from "../observability/trace";
import { Attributes } from "@opentelemetry/api";

const tracer = getTracer("langwatch.evaluation");

export function recordEvaluation(
  result: EvaluationRESTResult,
  attributes?: Attributes,
) {
  tracer.startActiveSpan("evaluation", (span) => {
    span.setType("evaluation");
    span.addEvent(intSemconv.ATTR_LANGWATCH_EVALUATION_CUSTOM, {
      json_encoded_event: JSON.stringify(result),
    });

    if (attributes) {
      span.setAttributes(attributes);
    }

    span.end();
    return;
  });
}
