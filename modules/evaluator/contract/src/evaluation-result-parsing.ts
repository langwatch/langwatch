import {
  serializedHandledErrorSchema,
  type SerializedHandledError,
} from "@langwatch/handled-error";

/**
 * One evaluation result, as every surface that renders one reads it.
 * `processed` carries a score with no pass or fail; `skipped` never ran.
 */
export type ParsedEvaluationResult = {
  status: "pending" | "running" | "passed" | "failed" | "processed" | "error" | "skipped";
  score?: number;
  label?: string;
  details?: string;
  domainError?: SerializedHandledError;
};

function readSerializedDomainError(candidate: unknown): SerializedHandledError | undefined {
  const result = serializedHandledErrorSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/**
 * Reads a raw evaluation result into that shape: a boolean, an object carrying
 * `passed` / `score` / `label` / `details`, an error, or nothing at all.
 */
export const parseEvaluationResult = (result: unknown): ParsedEvaluationResult => {
  if (result === null || result === undefined) {
    return { status: "pending" };
  }

  // Check for explicit running status (from execution)
  if (
    result === "running" ||
    (typeof result === "object" && (result as Record<string, unknown>).status === "running")
  ) {
    return { status: "running" };
  }

  if (typeof result === "boolean") {
    return { status: result ? "passed" : "failed" };
  }

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const parsed: ParsedEvaluationResult = { status: "pending" };

    // Check for error first - either { error: "message" } or { status: "error", details: "..." }
    if ("error" in obj && obj.error) {
      parsed.status = "error";
      parsed.details = typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
      parsed.domainError = readSerializedDomainError(obj.domainError);
      return parsed;
    }

    // Check for status: "error" format (from backend evaluator results)
    if ("status" in obj && obj.status === "error") {
      parsed.status = "error";
      if ("details" in obj && typeof obj.details === "string") {
        parsed.details = obj.details;
      }
      parsed.domainError = readSerializedDomainError(obj.domainError);
      return parsed;
    }

    // Check for skipped status
    if ("status" in obj && obj.status === "skipped") {
      parsed.status = "skipped";
      if ("details" in obj && typeof obj.details === "string") {
        parsed.details = obj.details;
      }
      return parsed;
    }

    // Check for running status
    if ("status" in obj && obj.status === "running") {
      return { status: "running" };
    }

    // Extract score
    if ("score" in obj && typeof obj.score === "number") {
      parsed.score = obj.score;
    }

    // Extract label
    if ("label" in obj && typeof obj.label === "string") {
      parsed.label = obj.label;
    }

    // Extract details
    if ("details" in obj && typeof obj.details === "string") {
      parsed.details = obj.details;
    }

    // Determine pass/fail status
    if ("passed" in obj && obj.passed !== null && obj.passed !== undefined) {
      parsed.status = obj.passed ? "passed" : "failed";
    } else if (
      parsed.score !== undefined ||
      parsed.label !== undefined ||
      parsed.details !== undefined
    ) {
      // Has results but no explicit pass/fail - show as processed (neutral)
      parsed.status = "processed";
    }

    return parsed;
  }

  return { status: "pending" };
};
