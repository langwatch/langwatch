/**
 * Parsed evaluation result with status information.
 * Used for rendering evaluation results in UI components.
 *
 * Status meanings:
 * - pending: Not yet executed
 * - running: Currently executing
 * - passed: Explicitly passed (passed=true)
 * - failed: Explicitly failed (passed=false)
 * - processed: Completed but no pass/fail (score-only evaluators)
 * - error: Execution error
 * - skipped: Intentionally skipped
 */
export type ParsedEvaluationResult = {
  status:
    | "pending"
    | "running"
    | "passed"
    | "failed"
    | "processed"
    | "error"
    | "skipped";
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

  // Check for explicit running status (from execution)
  if (
    result === "running" ||
    (typeof result === "object" &&
      (result as Record<string, unknown>).status === "running")
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
      parsed.details =
        typeof obj.error === "string" ? obj.error : JSON.stringify(obj.error);
      return parsed;
    }

    // Check for status: "error" format (from backend evaluator results)
    if ("status" in obj && obj.status === "error") {
      parsed.status = "error";
      if ("details" in obj && typeof obj.details === "string") {
        parsed.details = obj.details;
      }
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

/**
 * Status indicator colors for evaluation results.
 */
export const EVALUATION_STATUS_COLORS = {
  pending: "gray.400",
  running: "blue.400",
  passed: "green.500",
  failed: "red.500",
  processed: "blue.500", // Neutral color for score-only evaluators (no pass/fail)
  error: "red.500", // Errors should be red like failures
  skipped: "yellow.500",
} as const;

/**
 * Returns a human-readable status label.
 */
export const getStatusLabel = (
  status: ParsedEvaluationResult["status"],
): string => {
  switch (status) {
    case "running":
      return "Running";
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "processed":
      return "Processed";
    case "error":
      return "Error";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
};
