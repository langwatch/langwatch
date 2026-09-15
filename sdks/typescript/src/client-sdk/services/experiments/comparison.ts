/**
 * Comparison (n-way judging) for code-first experiments.
 *
 * Every target that recorded an output for a row is handed to
 * `langevals/select_best_compare` in a single call, and the winner comes back
 * named with the target name the caller registered.
 *
 * The judge owns its defaults. An option the caller did not set is absent from
 * the request, which is what lets the judge apply the default that fits the
 * row: it picks one of four prompts depending on whether the row carries a
 * reference answer and task context, so a copy of any of them shipped here
 * would both drift and silently disable that adaptation.
 */

import type {
  ComparisonOptions,
  ComparisonStatus,
  ComparisonVerdict,
  EvaluationStatus,
  RunEvaluatorResponse,
} from "./types";
import { ComparisonError } from "./errors";

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
 * Render a target's callback result as the text a judge can read.
 *
 * A lone `output` field is unwrapped to its own value, because that is the
 * shape a plain response is already recorded under, so returning the response
 * and returning `{ output: response }` reach the judge as the same text. A
 * response with several fields is presented whole, as JSON.
 *
 * An empty string means the target produced nothing for this row, and a target
 * with nothing to show is not a candidate: asking a judge to rank silence
 * produces a verdict about the wrong thing. A result that cannot be rendered
 * as text at all is treated the same way, since "[object Object]" tells a
 * judge even less than silence does.
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
 *
 * `golden` is the single knob for reference-answer judging: passing one turns
 * `has_golden_answer` on, so the two can never disagree.
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
 * The candidates the judge will see, in the order given.
 *
 * A name with nothing recorded against it never reaches here, and if one ever
 * does it is a bug in candidate selection rather than a thin row, so it says
 * which target it was instead of judging a silent candidate.
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
 * The judge entry for a row.
 *
 * `row_index` seeds the judge's deterministic candidate shuffle, so it comes
 * from the row the caller is already naming rather than from a second argument
 * they would have to remember to keep in step.
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
 * Translate the judge's result into a verdict.
 *
 * - a judged row with a winner is `decided`
 * - a judged row the judge called even is a `tie`
 * - a judged row the judge would not call, which under swap-and-reconcile
 *   means its two passes disagreed, is `inconclusive`: a finding about the
 *   candidates, and not a tie, which would claim a measurement never made
 * - a judge that failed or could not be reached is `error`, because nothing
 *   was measured about the candidates at all. Reporting that as
 *   `inconclusive` would dress a broken call up as a finding
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
 * The batch status a verdict is recorded under.
 *
 * The batch protocol carries three statuses to the verdict's five, so the
 * mapping lives here and nowhere else: what the row records and what the
 * caller is handed are then two readings of one decision rather than two
 * decisions that can drift apart.
 */
export const comparisonEntryStatus = (status: ComparisonStatus): EvaluationStatus => {
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
