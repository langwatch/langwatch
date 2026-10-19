/**
 * Comparison (n-way judging) via one call to `langevals/select_best_compare`.
 * The judge owns its defaults — an unset option stays absent from the request
 * so it can pick the prompt that fits the row; a copied default here would drift and disable that.
 */

import { ComparisonError } from "./errors";
import type {
  ComparisonOptions,
  ComparisonStatus,
  ComparisonVerdict,
  ExperimentEvaluationStatus,
  RunEvaluatorResponse,
} from "./types";

/** The evaluator behind every comparison, in the workbench and in the SDK. */
export const COMPARISON_EVALUATOR_SLUG = "langevals/select_best_compare";

/** Name a comparison is recorded under when the caller does not pick one. */
export const DEFAULT_COMPARISON_NAME = "comparison";

/**
 * One target's output for one row, captured when its withTarget() callback
 * resolves so a comparison never has to read it back out of a batch that may
 * already have been flushed.
 */
export type CapturedTargetOutput = {
  /** The callback result, rendered as the text the judge will read. */
  output: string;
  /** Wall-clock duration of the target execution, in milliseconds. */
  durationMs?: number;
};

/** One candidate as the judge receives it. */
export type ComparisonCandidatePayload = {
  id: string;
  output: string;
  /** Seconds, which is the unit the judge renders. */
  duration?: number;
};

/**
 * Render a target's callback result as text a judge can read. A lone `output`
 * field unwraps to its own value; other shapes render as JSON. Empty string
 * means nothing to show — an unparseable result is treated the same way.
 */
export const renderTargetOutput = (result: unknown): string => {
  if (result === undefined || result === null) {
    return "";
  }
  if (typeof result === "string") {
    return result;
  }
  if (typeof result === "number" || typeof result === "boolean" || typeof result === "bigint") {
    return String(result);
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    const fields = Object.keys(result);
    if (fields.length === 1 && fields[0] === "output") {
      return renderTargetOutput((result as { output: unknown }).output);
    }
  }
  try {
    return JSON.stringify(result) ?? "";
  } catch {
    return "";
  }
};

/**
 * The judge settings for a comparison, carrying only what the caller set.
 * `golden` is the single knob for reference-answer judging: passing one
 * turns `has_golden_answer` on, so the two can never disagree.
 */
export const buildComparisonSettings = (
  options: Pick<
    ComparisonOptions,
    | "golden"
    | "prompt"
    | "model"
    | "allowTie"
    | "randomizeOrder"
    | "swapAndReconcile"
    | "includeMetrics"
    | "temperature"
  >,
): Record<string, unknown> => {
  const settings: Record<string, unknown> = {};

  if (options.prompt !== undefined) settings.prompt = options.prompt;
  if (options.model !== undefined) settings.model = options.model;
  if (options.golden !== undefined) settings.has_golden_answer = true;
  if (options.allowTie !== undefined) settings.allow_tie = options.allowTie;
  if (options.randomizeOrder !== undefined) {
    settings.randomize_order = options.randomizeOrder;
  }
  if (options.swapAndReconcile !== undefined) {
    settings.swap_and_reconcile = options.swapAndReconcile;
  }
  if (options.includeMetrics !== undefined) {
    settings.include_metrics = options.includeMetrics;
  }
  if (options.temperature !== undefined) {
    settings.temperature = options.temperature;
  }

  return settings;
};

/**
 * The candidates the judge will see, in the order given. A name with
 * nothing recorded never reaches here; if one ever does, it's a bug in
 * candidate selection, so it names the target instead of judging silently.
 */
export const buildComparisonCandidates = (
  names: string[],
  captured: Map<string, CapturedTargetOutput>,
): ComparisonCandidatePayload[] =>
  names.map((name) => {
    const output = captured.get(name);
    if (!output) {
      throw new ComparisonError(
        `Cannot compare: '${name}' was selected as a candidate but recorded no output.`,
        [name],
      );
    }
    return {
      id: name,
      output: output.output,
      ...(output.durationMs !== undefined ? { duration: output.durationMs / 1000 } : {}),
    };
  });

/**
 * The judge entry for a row. `row_index` seeds the judge's deterministic
 * candidate shuffle, coming from the row the caller already names rather
 * than a second argument they'd have to keep in step.
 */
export const buildComparisonData = ({
  input,
  golden,
  candidates,
  index,
}: {
  input?: string;
  golden?: string;
  candidates: ComparisonCandidatePayload[];
  index: number;
}): Record<string, unknown> => ({
  ...(input !== undefined ? { input } : {}),
  ...(golden !== undefined ? { golden } : {}),
  candidates,
  row_index: index,
});

/**
 * Translate the judge's result into a verdict: `decided`, `tie`, or
 * `inconclusive` — the judge would not call it, a finding about the
 * candidates, not a claimed tie — or `error` when nothing was measured at all.
 */
export const toComparisonVerdict = ({
  response,
  candidates,
}: {
  response: RunEvaluatorResponse;
  candidates: string[];
}): ComparisonVerdict => {
  const reasoning = response.details ?? null;

  if (response.status === "error") {
    return { status: "error", winner: null, reasoning, candidates };
  }

  if (response.status !== "processed" || response.label == null) {
    return { status: "inconclusive", winner: null, reasoning, candidates };
  }

  if (response.label === "tie") {
    return { status: "tie", winner: null, reasoning, candidates };
  }

  return { status: "decided", winner: response.label, reasoning, candidates };
};

/**
 * The batch status a verdict is recorded under. The batch protocol carries
 * three statuses to the verdict's five, so this mapping lives here alone --
 * what the row records and what the caller reads are one decision, not two.
 */
export const comparisonEntryStatus = (status: ComparisonStatus): ExperimentEvaluationStatus => {
  switch (status) {
    case "decided":
    case "tie":
      return "processed";
    case "error":
      return "error";
    case "inconclusive":
    case "skipped":
      return "skipped";
  }
};

/**
 * The label a verdict is recorded under: the winner, "tie", or nothing.
 */
export const comparisonEntryLabel = (verdict: ComparisonVerdict): string | null => {
  if (verdict.status === "decided") return verdict.winner;
  if (verdict.status === "tie") return "tie";
  return null;
};

/**
 * Why a row could not be compared, naming the targets that had nothing to
 * contribute so the reader can tell a thin dataset from a broken target.
 */
export const describeSkippedComparison = ({
  candidates,
  missing,
}: {
  candidates: string[];
  missing: string[];
}): string => {
  const head = `A comparison needs at least two candidate outputs, this row has ${candidates.length}.`;
  if (missing.length === 0) {
    return head;
  }
  return `${head} No output was recorded for: ${missing.join(", ")}.`;
};
