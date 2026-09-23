import {
  serializedHandledErrorSchema,
  type SerializedHandledError,
} from "@langwatch/handled-error";

/**
 * Parsed evaluation result with status information. Used for rendering evaluation
 * results in UI components.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ExceptionalEvaluationResult =
  | { matched: true; value: ParsedEvaluationResult }
  | { matched: false };

function parseExceptionalEvaluationResult(
  result: Record<string, unknown>,
): ExceptionalEvaluationResult {
  if (result.error) {
    return {
      matched: true,
      value: {
        status: "error",
        details: typeof result.error === "string" ? result.error : JSON.stringify(result.error),
        domainError: readSerializedDomainError(result.domainError),
      },
    };
  }

  if (result.status === "error") {
    return {
      matched: true,
      value: {
        status: "error",
        details: typeof result.details === "string" ? result.details : undefined,
        domainError: readSerializedDomainError(result.domainError),
      },
    };
  }

  if (result.status === "skipped") {
    return {
      matched: true,
      value: {
        status: "skipped",
        details: typeof result.details === "string" ? result.details : undefined,
      },
    };
  }

  if (result.status === "running") {
    return { matched: true, value: { status: "running" } };
  }

  return { matched: false };
}

function parseObjectEvaluationResult(result: Record<string, unknown>): ParsedEvaluationResult {
  const exceptional = parseExceptionalEvaluationResult(result);
  if (exceptional.matched) return exceptional.value;

  const parsed: ParsedEvaluationResult = { status: "pending" };
  if (typeof result.score === "number") parsed.score = result.score;
  if (typeof result.label === "string") parsed.label = result.label;
  if (typeof result.details === "string") parsed.details = result.details;

  if (result.passed !== null && result.passed !== undefined) {
    parsed.status = result.passed ? "passed" : "failed";
  } else if (
    parsed.score !== undefined ||
    parsed.label !== undefined ||
    parsed.details !== undefined
  ) {
    parsed.status = "processed";
  }

  return parsed;
}

/**
 * Parses an unknown evaluation result into a typed structure.
 * @param result - The raw evaluation result (can be boolean, object, or undefined)
 * @returns Parsed evaluation result with status and optional score/label/details
 */
export const parseEvaluationResult = (result: unknown): ParsedEvaluationResult => {
  if (result === null || result === undefined) {
    return { status: "pending" };
  }

  if (result === "running") {
    return { status: "running" };
  }

  if (typeof result === "boolean") {
    return { status: result ? "passed" : "failed" };
  }

  if (isRecord(result)) return parseObjectEvaluationResult(result);

  return { status: "pending" };
};

/**
 * Status indicator colors: single source for dots, accents, fills across all
 * trace views and evaluator renderings.
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
 * Tag rendering pairs for evaluation statuses — bg / fg combinations tuned for
 * readability on light surfaces, used by the Evals accordion card's status pill and any
 * future "filled chip" surface.
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
 * Shape of any of the evaluation result variants we display as chips.
 */
export interface EvalChipInput {
  name?: string | null;
  /**
   * Alias for `name` matching the trace-list `TraceEvalResult` shape (which mirrors the
   * ClickHouse `EvaluatorName` column). The drawer header chip passes `name`; the trace
   * list passes a TraceEvalResult directly.
   */
  evaluatorName?: string | null;
  evaluatorId?: string | null;
  /** Normalized verdict tokens from any source. */
  status?: string;
  /** Numeric verdict, when produced. Booleans collapse to passed/failed. */
  score?: number | boolean | null;
  /** Categorical label, when the evaluator produced one. */
  label?: string | null;
  /** Explicit pass flag from a numeric/categorical evaluator. */
  passed?: boolean | null;
  /**
   * What kind of verdict the evaluator produced, where the caller knows.
   * `"categorical"` means it answered with a label and neither a number nor a pass/fail
   * — see {@link EvalChipDisplay.categoryLabel}.
   */
  scoreType?: "numeric" | "boolean" | "categorical" | null;
}

/** Normalized chip-display contract — single source of truth for both
 *  the trace-list `EvalChip` and the v2 drawer header eval chips so
 *  visuals never drift between surfaces. */
export interface EvalChipDisplay {
  // Mapped onto v3 status enum; consumers can reuse `EVALUATION_STATUS_COLORS`
  // / `getStatusLabel`.
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
   * Color-coded pass/fail label when the evaluator returned an explicit boolean verdict
   * (not a numeric score). `null` for numeric / skipped / error, and for a categorising
   * evaluator, which passed no judgement to label.
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
 * Resolve any evaluation result variant into the chip-display contract. Centralized so
 * the trace-table chip, the drawer header chip and any future surface (Evals accordion
 * list, etc.) render identical visuals for the same input.
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

/**
 * A categorising evaluator's verdict IS its label. Return it so callers can show it
 * where the score and the pass/fail would go: both are stand-ins invented for fields it
 * never filled, and printing them claims a run that scored zero and passed.
 */
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
