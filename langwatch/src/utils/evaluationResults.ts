/**
 * Parsed evaluation result with status information.
 * Used for rendering evaluation results in UI components.
 */
export type ParsedEvaluationResult = {
  status: "pending" | "passed" | "failed" | "error" | "skipped";
  score?: number;
  label?: string;
  details?: string;
};

/**
 * Parses an unknown evaluation result into a typed structure.
 * Handles boolean results, objects with passed/score/label/details fields,
 * and error states.
 *
 * @param result - The raw evaluation result (can be boolean, object, or undefined)
 * @returns Parsed evaluation result with status and optional score/label/details
 */
export const parseEvaluationResult = (
  result: unknown,
): ParsedEvaluationResult => {
  if (result === null || result === undefined) {
    return { status: "pending" };
  }

  if (typeof result === "boolean") {
    return { status: result ? "passed" : "failed" };
  }

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const parsed: ParsedEvaluationResult = { status: "pending" };

    // Check for error first
    if ("error" in obj) {
      parsed.status = "error";
      parsed.details =
        typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
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
    if ("passed" in obj) {
      parsed.status = obj.passed ? "passed" : "failed";
    } else if (parsed.score !== undefined) {
      // Infer status from score if passed is not explicitly set
      parsed.status = parsed.score >= 0.5 ? "passed" : "failed";
    }

    return parsed;
  }

  return { status: "pending" };
};

/**
 * Status indicator colors for evaluation results.
 */
export const EVALUATION_STATUS_COLORS = {
  pending: "gray.400",
  passed: "green.500",
  failed: "red.500",
  error: "orange.500",
  skipped: "yellow.500",
} as const;

/**
 * Returns a human-readable status label.
 */
export const getStatusLabel = (
  status: ParsedEvaluationResult["status"],
): string => {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "error":
      return "Error";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
};
