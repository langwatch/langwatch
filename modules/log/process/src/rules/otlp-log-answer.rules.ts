import type { LogOtlpDoorResult } from "@langwatch/log-contract";
import { otlpDoorFailureAnswer, type OtlpDoorAnswer } from "@langwatch/otlp";

/** Rejected records are named only when there are any; a clean batch answers `{}`, as main does. */
export function otlpLogAnswer(result: LogOtlpDoorResult): OtlpDoorAnswer {
  if (result.outcome !== "collected") return otlpDoorFailureAnswer({ result, signal: "logs" });

  if (result.rejectedLogRecords === 0) return { status: 200, body: {} };
  return {
    status: 200,
    body: {
      partialSuccess: {
        rejectedLogRecords: result.rejectedLogRecords,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      },
    },
  };
}
