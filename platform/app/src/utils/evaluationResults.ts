import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";

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
  domainError?: SerializedHandledError;
};

// `code` is HandledError's real discriminant; `kind` is a deprecated
// back-compat alias (see handled-error.ts). Older serialised payloads may
// carry only one of the two, so at least one is required and the other is
// derived from it.
const serializedReasonSchema: z.ZodType<{
  code: string;
  kind: string;
  fault?: "customer" | "platform" | "provider";
  traceId?: string;
  spanId?: string;
  meta?: Record<string, unknown>;
  tips?: readonly string[];
  docsUrl?: string;
  reasons?: unknown[];
}> = z.lazy(() =>
  z.object({
    code: z.string(),
    kind: z.string(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
    reasons: z.array(serializedReasonSchema).optional(),
  }),
);

const serializedHandledErrorSchema = z
  .object({
    code: z.string().optional(),
    kind: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    traceUrl: z.string().optional(),
    httpStatus: z.number(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
    reasons: z.array(serializedReasonSchema).optional(),
  })
  .refine((value) => value.code !== undefined || value.kind !== undefined)
  .transform((value): SerializedHandledError => {
    const code = value.code ?? value.kind!;
    return {
      code,
      kind: value.kind ?? code,
      httpStatus: value.httpStatus,
      meta: value.meta ?? {},
      traceId: value.traceId,
      spanId: value.spanId,
      traceUrl: value.traceUrl,
      fault: value.fault ?? "customer",
      ...(value.tips?.length ? { tips: value.tips } : {}),
      ...(value.docsUrl ? { docsUrl: value.docsUrl } : {}),
      reasons: (value.reasons ?? []) as SerializedHandledError["reasons"],
    };
  });

function readSerializedDomainError(
  candidate: unknown,
): SerializedHandledError | undefined {
  const result = serializedHandledErrorSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

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

/**
 * Status indicator colors for evaluation results — single source of
 * truth for dots, popover accents, score-bar fills, and any other
 * "one colour per status" rendering across the trace list, the v2
 * drawer header, the Evals accordion cards, and the v3 evaluator
 * chips. Update here and every surface follows.
 */
export const EVALUATION_STATUS_COLORS = {
  pending: "gray.emphasized",
  running: "blue.solid",
  passed: "green.solid",
  failed: "red.solid",
  processed: "blue.solid", // Neutral color for score-only evaluators (no pass/fail)
  // Errors get one step deeper red than a fail verdict — distinct
  // enough to read as "the evaluator broke" without going so dark it
  // looks like a different colour entirely.
  error: "red.fg",
  // Skipped is a setup state, not a verdict — light grey (closer to
  // the muted bg than to fg) keeps it from competing for attention
  // next to real pass/fail rows.
  skipped: "gray.muted",
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
  error: { bg: "red.subtle", fg: "red.fg" },
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
  /**
   * What kind of verdict the evaluator produced, where the caller knows.
   * `"categorical"` means it answered with a label and neither a number
   * nor a pass/fail — see {@link EvalChipDisplay.categoryLabel}.
   *
   * Worth passing wherever it is known, because `score` alone cannot carry
   * the distinction: some callers substitute `0` for a score the evaluator
   * never produced, and a chip reading that as a real zero reports a
   * failing-looking verdict nobody returned.
   */
  scoreType?: "numeric" | "boolean" | "categorical" | null;
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
   * error, and for a categorising evaluator, which passed no judgement to
   * label.
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
export function formatEvalScoreText(
  score: number | boolean | null | undefined,
): string | null {
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
    displayName:
      input.name || input.evaluatorName || input.evaluatorId || "Unknown",
    scoreText,
    noVerdict,
    passLabel:
      scoreText == null && categoryLabel == null && !noVerdict
        ? resolvePassLabel(status)
        : null,
  };
}

/**
 * A categorising evaluator's verdict IS its label. Return it so callers can
 * show it where the score and the pass/fail would go: both are stand-ins
 * invented for fields it never filled, and printing them claims a run that
 * scored zero and passed.
 *
 * A caller that knows its `scoreType` is believed over `score`, because its
 * `score` may be one of those stand-ins. A caller that doesn't know is read
 * off the raw fields: a label with neither a score nor a verdict beside it
 * came from an evaluator that only categorised. A boolean score is a verdict,
 * so it never reads as a category no matter what it is labelled.
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
    input.scoreType === "categorical" ||
    (input.scoreType == null && input.score == null);
  return isCategorical ? input.label : null;
}

/**
 * The colored Pass/Fail label, for evaluators that produced a pure boolean
 * verdict with no numeric score to show in its place.
 */
function resolvePassLabel(
  status: ParsedEvaluationResult["status"],
): EvalChipDisplay["passLabel"] {
  if (status === "passed") return { text: "Pass", color: "green.fg" };
  if (status === "failed") return { text: "Fail", color: "red.fg" };
  return null;
}
