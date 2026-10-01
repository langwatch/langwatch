import { formatCost, formatDuration } from "@langwatch/trace-browser-kit";

import { type EvalEntry, isCategoryOnly, isNoVerdict } from "./utils.ts";

export type EvalScoreDisplay = { label: string; subLabel: string; barFill: number };

const NO_SCORE: EvalScoreDisplay = { label: "", subLabel: "", barFill: 0 };

/** The big score in the header and how full its bar is, for a run that produced a verdict. */
export function scoreDisplayOf({ score, scoreType }: EvalEntry): EvalScoreDisplay {
  if (scoreType === "boolean") {
    return {
      label: score === true ? "PASS" : "FAIL",
      subLabel: "",
      barFill: score === true ? 100 : 0,
    };
  }
  if (scoreType === "numeric" && typeof score === "number") {
    return score <= 1
      ? { label: score.toFixed(2), subLabel: "/ 1.00", barFill: score * 100 }
      : { label: score.toFixed(1), subLabel: "/ 10", barFill: Math.min(100, score * 10) };
  }
  if (scoreType === "categorical") return { label: String(score), subLabel: "", barFill: 50 };
  return NO_SCORE;
}

/** Duration, cost, evaluator type and retries, each only when there is one to say. */
function metaOf(eval_: EvalEntry): string[] {
  const retries = eval_.retries ?? 0;
  return [
    eval_.executionTime !== undefined && eval_.executionTime > 0
      ? formatDuration(eval_.executionTime)
      : "",
    eval_.evalCost !== undefined && eval_.evalCost > 0 ? formatCost(eval_.evalCost) : "",
    eval_.evaluatorType ?? "",
    retries > 0 ? `${retries} retr${retries === 1 ? "y" : "ies"}` : "",
  ].filter((part) => part !== "");
}

/**
 * Whether the card can offer inputs. The verdict list may drop the heavy inputs
 * blob, so a run that produced a verdict or errored offers them and fetches on open.
 */
function mightHaveInputsOf(eval_: EvalEntry): boolean {
  if (eval_.inputs && Object.keys(eval_.inputs).length > 0) return true;
  if (!eval_.evaluationId) return false;
  return ["pass", "fail", "processed", "error"].includes(eval_.status);
}

/** What an errored run adds: the message leading the card, and the error details. */
function errorViewOf(eval_: EvalEntry) {
  const isError = eval_.status === "error";
  // For skipped and errored runs the reasoning is the message; without it the
  // error message stands in, and the worker always writes one or the other.
  const primaryStatusText = eval_.reasoning ?? (isError ? eval_.errorMessage : undefined);
  const showErrorPanel =
    isError && !!eval_.errorMessage && !!eval_.reasoning && eval_.errorMessage !== eval_.reasoning;
  const showErrorIds = isError && (!!eval_.evaluationId || !!eval_.evaluatorId);
  return { primaryStatusText, showErrorPanel, showErrorIds };
}

/** Everything the card decides about an evaluation before it renders it. */
export function evalCardView(eval_: EvalEntry) {
  const noVerdict = isNoVerdict(eval_.status);
  // A categorising evaluator answers with a category and nothing else: its
  // category leads the header in place of a badge and a stand-in score.
  const categoryOnly = isCategoryOnly(eval_);
  const meta = metaOf(eval_);
  // The label can say more than the score (score=1, label="safe"), so the header
  // carries it; a category-only run shows it even when it repeats the score.
  const hasLabel = !!eval_.label && (categoryOnly || eval_.label !== String(eval_.score));
  const showLabelDetailRow = hasLabel && !categoryOnly;
  const { primaryStatusText, showErrorPanel, showErrorIds } = errorViewOf(eval_);
  const hasStacktrace = (eval_.errorStacktrace?.length ?? 0) > 0;
  const mightHaveInputs = mightHaveInputsOf(eval_);
  const hasExpandableDetails =
    mightHaveInputs || hasStacktrace || showLabelDetailRow || showErrorPanel || showErrorIds;
  const hasReasoning = (eval_.reasoning?.length ?? 0) > 0;
  const hasVerdict = !noVerdict && !categoryOnly;
  return {
    categoryOnly,
    hasVerdict,
    score: hasVerdict ? scoreDisplayOf(eval_) : NO_SCORE,
    showScoreBar: hasVerdict && eval_.scoreType === "numeric" && typeof eval_.score === "number",
    hasLabel,
    showLabelDetailRow,
    meta,
    hasReasoning,
    primaryStatusText,
    showStatusMessage: noVerdict && !!primaryStatusText,
    showReasoningPanel: hasReasoning || (noVerdict && !!primaryStatusText),
    hasHeaderRule: hasReasoning || meta.length > 0 || !!eval_.spanName,
    showErrorPanel,
    showErrorIds,
    hasStacktrace,
    mightHaveInputs,
    hasExpandableDetails,
    hasFooterRow: !!eval_.spanName || meta.length > 0 || hasExpandableDetails,
  };
}

export type EvalCardView = ReturnType<typeof evalCardView>;
