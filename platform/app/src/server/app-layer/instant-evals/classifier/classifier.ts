/**
 * The Instant Evals classifier interface — one text, several typed questions,
 * one verdict each.
 *
 * Instant Evals judge production history at a scale where the judge's cost and
 * latency are the product: a query asking one question of a thousand
 * conversations is a thousand calls, so the model behind it is a choice we
 * expect to revisit. This interface is what makes that a swap rather than a
 * rewrite. Everything above it — the LangWatchQL eval functions, the hydration
 * stage, the cost row — names only what is declared here, and no caller holds a
 * provider constant of its own.
 *
 * Two facts travel with the implementation rather than with its callers:
 *
 *  - {@link InstantEvalClassifierLimits}, because how much text fits in one
 *    request is a property of the model, and the caller's job is to respect it,
 *    not to know it.
 *  - {@link InstantEvalPricing}, for the same reason: the cost row is written
 *    from what the classifier reports it charged.
 *
 * The shipped implementation (`./jev.client.ts`) calls TypeSafe Jev with
 * **LangWatch's own key**, never a customer's — this is a platform capability
 * the customer is billed for, not a bring-your-own-model integration.
 *
 * @see ./null.client.ts — what a deployment with no key gets
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

/** What a question asks for, which decides how its answer is read. */
export const INSTANT_EVAL_QUESTION_KINDS = [
  "boolean",
  "score",
  "category",
] as const;

export type InstantEvalQuestionKind =
  (typeof INSTANT_EVAL_QUESTION_KINDS)[number];

/** A yes-or-no question, answered with a calibrated probability. */
export interface InstantEvalBooleanQuestion {
  readonly id: string;
  readonly kind: "boolean";
  /** The question, in the caller's own words. */
  readonly instructions: string;
  /**
   * What counts as yes, and what counts as no — in that order.
   *
   * Optional because the instructions alone are often enough, and a pair
   * rather than a list because that is the shape the judgement has: a boundary
   * has two sides, and a third criterion would have nowhere to go.
   */
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
  readonly options: readonly {
    readonly name: string;
    readonly description: string;
  }[];
}

export type InstantEvalQuestion =
  | InstantEvalBooleanQuestion
  | InstantEvalScoreQuestion
  | InstantEvalCategoryQuestion;

/**
 * Why one text went unjudged.
 *
 * A skip is not an error: the query ran, the row is real, and the honest
 * answer for that cell is "we did not judge this", which is null plus a
 * diagnostic. An error is reserved for a classifier that is not answering at
 * all, where every row would carry the same skip and a null column would read
 * as "nothing matched".
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
  /** One per question asked, in the order they were asked. Empty when skipped. */
  readonly verdicts: readonly InstantEvalVerdict[];
  /** Set when nothing was judged, and why. */
  readonly skippedReason?: InstantEvalSkipReason;
  /** Input tokens the classifier billed for. Zero for a skip. */
  readonly inputTokens: number;
  /** Whether the text had to be cut to fit the request. */
  readonly isTextTruncated: boolean;
}

/** What one request may carry. Published by the implementation, never assumed. */
export interface InstantEvalClassifierLimits {
  /** Tokens of judged text one request may carry. */
  readonly stateTokens: number;
  /** Tokens of text, questions and answer space together. */
  readonly totalTokens: number;
  /** Options one category question may offer. */
  readonly maxCategoryOptions: number;
  /**
   * Tokens held back from the text budget for everything that is neither the
   * text nor the questions: the envelope, and the space the answers need.
   */
  readonly reserveTokens: number;
}

/** What the classifier charges, and what the customer is charged. */
export interface InstantEvalPricing {
  /** Output tokens are free on the shipped classifier, so only input is priced. */
  readonly usdPerMillionInputTokens: number;
  /** Multiplier from our cost to the customer's price. */
  readonly markup: number;
}

export interface InstantEvalClassifyRequest {
  /** The text to judge, already cut to the text budget by the caller. */
  readonly text: string;
  /** Every question about that text, asked in one request. */
  readonly questions: readonly InstantEvalQuestion[];
}

/**
 * The judge behind a judged column.
 *
 * `classify` answers or skips; it throws only when the classifier itself is
 * not usable — a bad credential, an unreachable host, a response that is not
 * the contract. The caller turns a throw into a refusal for the whole query
 * and a skip into a null cell, which is the difference between "we cannot do
 * this" and "we did not do this one".
 */
export interface InstantEvalClassifier {
  readonly limits: InstantEvalClassifierLimits;
  readonly pricing: InstantEvalPricing;
  classify(
    request: InstantEvalClassifyRequest,
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement>;
  /** Releases the transport, where the implementation holds one. */
  close?(): Promise<void>;
}

/** A judgement that judged nothing, for the reason given. */
export function instantEvalSkipped(
  reason: InstantEvalSkipReason,
): InstantEvalJudgement {
  return {
    verdicts: [],
    skippedReason: reason,
    inputTokens: 0,
    isTextTruncated: false,
  };
}
