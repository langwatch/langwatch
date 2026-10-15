import type { MetricOtlpDoorResult } from "@langwatch/metric-contract";
import { otlpDoorFailureAnswer, type OtlpDoorAnswer } from "@langwatch/otlp";

/** Rejected points are named only when there are any; a clean batch answers `{}`, as main does. */
export function otlpMetricAnswer(result: MetricOtlpDoorResult): OtlpDoorAnswer {
  if (result.outcome !== "collected") return otlpDoorFailureAnswer({ result, signal: "metrics" });

  if (result.rejectedDataPoints === 0) return { status: 200, body: {} };
  return {
    status: 200,
    body: {
      partialSuccess: {
        rejectedDataPoints: result.rejectedDataPoints,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      },
    },
  };
}
