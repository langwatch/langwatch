/**
 * What a judge is asked and what it answers, portable because the run, the
 * wire and the judge all name them.
 *
 * @see specs/instant-evals/classifier.feature
 */

/** What a question asks for, which decides how its answer is read. */
export const INSTANT_EVAL_QUESTION_KINDS = ["boolean", "score", "category"] as const;

export type InstantEvalQuestionKind = (typeof INSTANT_EVAL_QUESTION_KINDS)[number];

/** A yes-or-no question, answered with a calibrated probability. */
export interface InstantEvalBooleanQuestion {
  readonly id: string;
  readonly kind: "boolean";
  readonly instructions: string;
  /** What counts as yes, then what counts as no. A boundary has two sides. */
  readonly criteria?: readonly [string, string];
}

/** A rating on a whole-numbered scale, answered with a weighted mean. */
export interface InstantEvalScoreQuestion {
  readonly id: string;
  readonly kind: "score";
  readonly instructions: string;
  /** Inclusive bounds. Every whole number between them is a level. */
  readonly range: { readonly min: number; readonly max: number };
}

/** One named option out of a closed set. */
export interface InstantEvalCategoryQuestion {
  readonly id: string;
  readonly kind: "category";
  readonly instructions: string;
  readonly options: readonly { readonly name: string; readonly description: string }[];
}

export type InstantEvalQuestion =
  | InstantEvalBooleanQuestion
  | InstantEvalScoreQuestion
  | InstantEvalCategoryQuestion;

/**
 * Why one text went unjudged. A skip is not an error: the query ran, and the
 * honest answer for that cell is null plus a diagnostic.
 */
export const INSTANT_EVAL_SKIP_REASONS = [
  "classifier_not_configured",
  "classifier_rate_limited",
  "classifier_input_too_large",
  "classifier_failed",
] as const;

export type InstantEvalSkipReason = (typeof INSTANT_EVAL_SKIP_REASONS)[number];

/** One question's answer. */
export interface InstantEvalVerdict {
  readonly questionId: string;
  /** Probability of yes, for a boolean question. */
  readonly probability?: number;
  /** The probability-weighted mean inside the declared range, for a score. */
  readonly score?: number;
  /** The most likely option name, for a category. */
  readonly label?: string;
  /** Every option's probability, for a category. Sums to one. */
  readonly probabilities?: Readonly<Record<string, number>>;
}

/** Everything one classification answered, whether or not it answered. */
export interface InstantEvalJudgement {
  /** One per question asked, in the order asked. Empty when skipped. */
  readonly verdicts: readonly InstantEvalVerdict[];
  readonly skippedReason?: InstantEvalSkipReason;
  /** Input tokens the classifier billed for. Zero for a skip. */
  readonly inputTokens: number;
  readonly isTextTruncated: boolean;
  /**
   * Time this classification waited for rate-limit capacity. A run whose wall
   * clock is limiter wait and one whose wall clock is provider latency need
   * opposite fixes, and elapsed time alone cannot tell them apart.
   */
  readonly limiterWaitMs?: number;
}

/** What the classifier charges, and what the customer is charged. */
export interface InstantEvalPricing {
  /** Output tokens are free on the shipped classifier, so only input is priced. */
  readonly usdPerMillionInputTokens: number;
  /** Multiplier from our cost to the customer's price. */
  readonly markup: number;
}

/** A judgement that judged nothing, for the reason given. */
export function instantEvalSkipped(reason: InstantEvalSkipReason): InstantEvalJudgement {
  return { verdicts: [], skippedReason: reason, inputTokens: 0, isTextTruncated: false };
}
