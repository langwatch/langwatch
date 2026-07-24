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

export type ConfidenceInterval = {
  lower: number;
  upper: number;
};

export type ConfusionMatrixMetrics = ConfusionMatrixCounts & {
  total: number;
  accuracy: number;
  /** 95% Wilson score interval around accuracy. Null when there are no rows. */
  accuracyInterval: ConfidenceInterval | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
  /**
   * Share of annotated rows the reviewer marked as a pass. Accuracy is
   * unreadable without it: a judge that blindly answers "pass" scores
   * exactly the prevalence.
   */
  prevalence: number | null;
  /**
   * The agreement rate two raters would hit by chance alone, given how
   * often each says "pass". Accuracy has to clear this bar to mean
   * anything. Null when there are no rows.
   */
  chanceAgreement: number | null;
  /**
   * Cohen's kappa — agreement after subtracting the agreement two raters
   * would reach by chance alone. Negative means worse than guessing. Null
   * when chance agreement is already total, which leaves kappa undefined.
   */
  cohensKappa: number | null;
};

/** z for a two-sided 95% interval. */
const Z_95 = 1.959964;

/**
 * Wilson score interval for a binomial proportion.
 *
 * Preferred over the textbook Wald interval (p ± z·√(p(1-p)/n)) because
 * this chart's whole job is small samples: Wald under-covers badly below
 * ~n=40, spills outside [0, 1], and degenerates to zero width at p=0 or
 * p=1 — reporting perfect certainty from a handful of rows, which is the
 * exact misreading the interval is here to prevent. Wilson keeps sane
 * coverage down to single-digit n.
 */
export const wilsonInterval = ({
  successes,
  trials,
  z = Z_95,
}: {
  successes: number;
  trials: number;
  z?: number;
}): ConfidenceInterval | null => {
  if (trials <= 0) return null;

  const proportion = successes / trials;
  const zSquared = z * z;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / trials +
        zSquared / (4 * trials * trials),
    );

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
};

/**
 * Conventional Landis & Koch (1977) descriptors for a kappa value. These
 * bands are a shared reading convention, not a statistical result — they
 * exist so the number is legible to someone who does not work with kappa
 * daily.
 */
export const kappaAgreementLabel = (kappa: number): string => {
  if (kappa < 0.01) return "none";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
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

  const prevalence = total > 0 ? actualPositive / total : null;

  // Agreement two raters would reach by chance alone, given how often each
  // of them says "pass". This is the bar accuracy has to clear to mean
  // anything — a judge scoring at this level has matched the base rate and
  // demonstrated nothing.
  const judgePassRate = total > 0 ? predictedPositive / total : 0;
  const reviewerPassRate = total > 0 ? actualPositive / total : 0;
  const chanceAgreement =
    total > 0
      ? judgePassRate * reviewerPassRate +
        (1 - judgePassRate) * (1 - reviewerPassRate)
      : null;

  // chanceAgreement === 1 means both raters used a single category
  // throughout, so the correction divides by zero. Kappa is genuinely
  // undefined there — reporting 1.0 would dress a degenerate case up as a
  // perfect one.
  const cohensKappa =
    chanceAgreement !== null && chanceAgreement < 1
      ? (accuracy - chanceAgreement) / (1 - chanceAgreement)
      : null;

  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    total,
    accuracy,
    accuracyInterval: wilsonInterval({
      successes: truePositive + trueNegative,
      trials: total,
    }),
    precision,
    recall,
    f1,
    falsePositiveRate,
    prevalence,
    chanceAgreement,
    cohensKappa,
  };
};
