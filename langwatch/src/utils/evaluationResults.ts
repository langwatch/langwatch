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
 * Status indicator colors for evaluation results — single source of
 * truth for dots, popover accents, score-bar fills, and any other
 * "one colour per status" rendering across the trace list, the v2
 * drawer header, the Evals accordion cards, and the v3 evaluator
 * chips. Update here and every surface follows.
 */
export const EVALUATION_STATUS_COLORS = {
  pending: "gray.400",
  running: "blue.400",
  passed: "green.500",
  failed: "red.500",
  processed: "blue.500", // Neutral color for score-only evaluators (no pass/fail)
  // Errors get one step deeper red than a fail verdict — distinct
  // enough to read as "the evaluator broke" without going so dark it
  // looks like a different colour entirely.
  error: "red.600",
  // Skipped is a setup state, not a verdict — light grey (closer to
  // the muted bg than to fg) keeps it from competing for attention
  // next to real pass/fail rows.
  skipped: "gray.300",
} as const;

/**
 * Tag rendering pairs for evaluation statuses — bg / fg combinations
 * tuned for readability on light surfaces, used by the Evals accordion
 * card's status pill and any future "filled chip" surface. Always
 * derived from the same enum as `EVALUATION_STATUS_COLORS` so the
 * dot colour and the tag colour can't drift out of step.
 */
export const EVALUATION_STATUS_TONES = {
  pending: { bg: "gray.subtle", fg: "fg.muted" },
  running: { bg: "blue.subtle", fg: "blue.fg" },
  passed: { bg: "green.subtle", fg: "green.fg" },
  failed: { bg: "red.subtle", fg: "red.fg" },
  processed: { bg: "blue.subtle", fg: "blue.fg" },
  // Slightly deeper red foreground to match the dot, but a step
  // lighter than red.700 so it still reads as red rather than maroon.
  error: { bg: "red.subtle", fg: "red.600" },
  // Gray-on-gray skipped tone — neutral, low-attention.
  skipped: { bg: "bg.muted", fg: "fg.muted" },
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

/**
 * Shape of any of the evaluation result variants we display as chips.
 * Tolerates the slightly different status enums used by the legacy
 * v1 trace summary (`pass`/`fail`/`warning`) and the v3 evaluator
 * runner (`passed`/`failed`/`processed`/`running`/`pending`).
 */
export interface EvalChipInput {
  name?: string | null;
  /**
   * Alias for `name` matching the trace-list `TraceEvalResult` shape
   * (which mirrors the ClickHouse `EvaluatorName` column). The drawer
   * header chip passes `name`; the trace list passes a TraceEvalResult
   * directly. Accept both so neither surface has to remember to remap.
   */
  evaluatorName?: string | null;
  evaluatorId?: string | null;
  /** Normalized verdict tokens from any source. */
  status?:
    | "pass"
    | "passed"
    | "fail"
    | "failed"
    | "processed"
    | "warning"
    | "skipped"
    | "error"
    | "running"
    | "in_progress"
    | "scheduled"
    | "pending"
    | string;
  /** Numeric verdict, when produced. Booleans collapse to passed/failed. */
  score?: number | boolean | null;
  /** Categorical label, when the evaluator produced one. */
  label?: string | null;
  /** Explicit pass flag from a numeric/categorical evaluator. */
  passed?: boolean | null;
}

/** Normalized chip-display contract — single source of truth for both
 *  the trace-list `EvalChip` and the v2 drawer header eval chips so
 *  visuals never drift between surfaces. */
export interface EvalChipDisplay {
  /** Mapped onto the v3 status enum so consumers can reuse `EVALUATION_STATUS_COLORS` / `getStatusLabel`. */
  status: ParsedEvaluationResult["status"];
  /** Chakra color token for the status dot / accent. */
  color: string;
  /** "Pass" / "Fail" / "Skipped" / ... — short title-case label. */
  statusLabel: string;
  /** Best-effort display name (evaluator name → id). */
  displayName: string;
  /** Formatted numeric score when present, else null. */
  scoreText: string | null;
  /** Whether the verdict is "no real score" (skipped or error). */
  noVerdict: boolean;
  /**
   * Color-coded pass/fail label when the evaluator returned an explicit
   * boolean verdict (not a numeric score). `null` for numeric / skipped /
   * error.
   */
  passLabel: { text: string; color: string } | null;
}

/** Map any source's status string onto the canonical v3 status enum. */
function normalizeEvalStatus(
  input: EvalChipInput,
): ParsedEvaluationResult["status"] {
  switch (input.status) {
    case "passed":
    case "pass":
      return "passed";
    case "failed":
    case "fail":
      return "failed";
    case "skipped":
      return "skipped";
    case "error":
      return "error";
    case "running":
    case "in_progress":
      return "running";
    case "pending":
    case "scheduled":
      return "pending";
    case "warning":
      // Warning isn't a v3 status; nearest equivalent is a non-fatal
      // verdict — surface as "failed" so the chip turns red and the
      // operator sees something went sideways.
      return "failed";
    case "processed":
      if (input.passed === true) return "passed";
      if (input.passed === false) return "failed";
      return "processed";
    default:
      if (input.passed === true) return "passed";
      if (input.passed === false) return "failed";
      return "pending";
  }
}

/** Same score formatter used by the trace table EvalChip — share so the
 *  drawer chip never disagrees on rounding. */
export function formatEvalScoreText(score: number | boolean | null | undefined): string | null {
  if (typeof score !== "number") return null;
  return score <= 1 ? score.toFixed(2) : score.toFixed(1);
}

/**
 * Resolve any evaluation result variant into the chip-display contract.
 * Centralized so the trace-table chip, the drawer header chip and any
 * future surface (Evals accordion list, etc.) render identical visuals
 * for the same input.
 */
export function getEvalChipDisplay(input: EvalChipInput): EvalChipDisplay {
  const status = normalizeEvalStatus(input);
  const color = EVALUATION_STATUS_COLORS[status];
  const statusLabel = getStatusLabel(status);
  const displayName =
    input.name || input.evaluatorName || input.evaluatorId || "Unknown";
  const scoreText =
    typeof input.score === "number" ? formatEvalScoreText(input.score) : null;
  const noVerdict = status === "skipped" || status === "error";

  // Surface a colored Pass/Fail label only when the evaluator produced a
  // pure boolean verdict (no numeric score to show in its place).
  let passLabel: EvalChipDisplay["passLabel"] = null;
  if (scoreText == null && !noVerdict) {
    if (status === "passed")
      passLabel = { text: "Pass", color: "green.fg" };
    else if (status === "failed")
      passLabel = { text: "Fail", color: "red.fg" };
  }

  return {
    status,
    color,
    statusLabel,
    displayName,
    scoreText,
    noVerdict,
    passLabel,
  };
}
