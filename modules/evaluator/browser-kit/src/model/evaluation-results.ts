import type { ParsedEvaluationResult } from "@langwatch/evaluator-contract";

/**
 * Status colors for evaluation results — single source of truth across
 * the trace list, drawer header, Evals accordion, and evaluator chips.
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
 * Tag bg/fg pairs for evaluation statuses, used by the Evals accordion
 * status pill. Derived from the same enum as `EVALUATION_STATUS_COLORS`
 * so dot and tag colors can't drift out of step.
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
export const getStatusLabel = (status: ParsedEvaluationResult["status"]): string => {
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
 * Chip-display shape tolerating both the legacy v1 status enum
 * (pass/fail/warning) and the v3 evaluator runner enum
 * (passed/failed/processed/running/pending).
 */
export interface EvalChipInput {
  name?: string | null;
  /**
   * Alias for `name` matching `TraceEvalResult` (mirrors the ClickHouse
   * `EvaluatorName` column). Accept both so callers don't remap.
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
  /** Verdict type: "numeric", "boolean", or "categorical"; needed for proper display. */
  scoreType?: "numeric" | "boolean" | "categorical" | null;
}

/** Normalized chip-display contract — single source of truth for both
 *  the trace-list `EvalChip` and the v2 drawer header eval chips so
 *  visuals never drift between surfaces. */
export interface EvalChipDisplay {
  /** Mapped to v3 status enum; reuses `EVALUATION_STATUS_COLORS` and `getStatusLabel`. */
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
   * Color-coded pass/fail label for an explicit boolean verdict; `null`
   * for numeric, skipped, error, or categorising results.
   */
  passLabel: { text: string; color: string } | null;
  /**
   * The category a categorising evaluator answered with — the whole of its
   * verdict, and what a chip shows where a score or a Pass would otherwise
   * go. `null` for every evaluator that scored or judged.
   */
  categoryLabel: string | null;
}

/** Map any source's status string onto the canonical v3 status enum. */
function normalizeEvalStatus(input: EvalChipInput): ParsedEvaluationResult["status"] {
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
 * Resolves any evaluation result variant into the chip-display contract,
 * so every surface renders identical visuals for the same input.
 */
export function getEvalChipDisplay(input: EvalChipInput): EvalChipDisplay {
  const status = normalizeEvalStatus(input);
  const noVerdict = status === "skipped" || status === "error";
  const categoryLabel = resolveCategoryLabel({ input, noVerdict });
  const scoreText =
    categoryLabel == null && typeof input.score === "number"
      ? formatEvalScoreText(input.score)
      : null;

  return {
    status,
    color: EVALUATION_STATUS_COLORS[status],
    statusLabel: getStatusLabel(status),
    categoryLabel,
    displayName: input.name || input.evaluatorName || input.evaluatorId || "Unknown",
    scoreText,
    noVerdict,
    passLabel:
      scoreText == null && categoryLabel == null && !noVerdict ? resolvePassLabel(status) : null,
  };
}

/** Categorical evaluator label only; score is a stand-in for missing fields. */
function resolveCategoryLabel({
  input,
  noVerdict,
}: {
  input: EvalChipInput;
  noVerdict: boolean;
}): string | null {
  if (noVerdict || !input.label || input.passed != null) return null;
  const isCategorical =
    input.scoreType === "categorical" || (input.scoreType == null && input.score == null);
  return isCategorical ? input.label : null;
}

/**
 * The colored Pass/Fail label, for evaluators that produced a pure boolean
 * verdict with no numeric score to show in its place.
 */
function resolvePassLabel(status: ParsedEvaluationResult["status"]): EvalChipDisplay["passLabel"] {
  if (status === "passed") return { text: "Pass", color: "green.fg" };
  if (status === "failed") return { text: "Fail", color: "red.fg" };
  return null;
}
