/**
 * computeConfusionMatrix - pure aggregation from resolved judge/reviewer
 * pairs to a 2x2 confusion matrix plus derived accuracy metrics.
 *
 * "Predicted" is the pass/fail evaluator's own verdict; "actual" is the
 * independent ground truth (a human reviewer's annotation on the same
 * target output). Undefined precision/recall/F1/false-positive-rate mean
 * the denominator is zero (e.g. the judge never predicted a positive) —
 * callers render "—" rather than a misleading 0%.
 */

export type JudgeAnnotationPair = {
  rowIndex: number;
  /** The evaluator's own pass/fail verdict for this row. */
  predicted: boolean;
  /** The human reviewer's ground truth for the same target output. */
  actual: boolean;
};

export type ConfusionMatrixCounts = {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
};

export type ConfusionMatrixMetrics = ConfusionMatrixCounts & {
  total: number;
  accuracy: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
};

export const computeConfusionMatrix = (
  pairs: JudgeAnnotationPair[],
): ConfusionMatrixMetrics => {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;

  for (const { predicted, actual } of pairs) {
    if (predicted && actual) truePositive++;
    else if (predicted && !actual) falsePositive++;
    else if (!predicted && actual) falseNegative++;
    else trueNegative++;
  }

  const total = pairs.length;
  const accuracy = total > 0 ? (truePositive + trueNegative) / total : 0;

  const predictedPositive = truePositive + falsePositive;
  const actualPositive = truePositive + falseNegative;
  const actualNegative = falsePositive + trueNegative;

  const precision = predictedPositive > 0 ? truePositive / predictedPositive : null;
  const recall = actualPositive > 0 ? truePositive / actualPositive : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const falsePositiveRate =
    actualNegative > 0 ? falsePositive / actualNegative : null;

  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    total,
    accuracy,
    precision,
    recall,
    f1,
    falsePositiveRate,
  };
};
