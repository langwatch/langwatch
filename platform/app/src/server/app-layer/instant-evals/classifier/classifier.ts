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
  /**
   * Time this classification spent waiting for rate-limit capacity, over
   * every attempt it made.
   *
   * Reported because a run whose wall clock is limiter wait and one whose wall
   * clock is provider latency need opposite fixes, and nothing downstream can
   * tell them apart from the elapsed time alone.
   */
  readonly limiterWaitMs?: number;
}

/** What one request may carry. Published by the implementation, never assumed. */
export interface InstantEvalClassifierLimits {
  /**
   * Tokens one request may carry for the text **and** its questions together.
   *
   * Measured, because the name suggests otherwise and the wrong reading costs
   * a failed request per row: 33,000 estimated tokens of text alone is
   * accepted (29,606 real input tokens), while 31,000 of text plus a
   * five-thousand-token question payload is refused with
   * `max_tokens_exceeded`. So the questions are charged against this ceiling
   * and the text budget is this less the questions less the reserve. Budgeting
   * the text against the total ceiling instead would over-fill every request
   * carrying a large category question.
   */
  readonly stateTokens: number;
  /**
   * Tokens the whole exchange may carry, the answers included.
   *
   * Not the text ceiling, and not what the text budget is derived from: it is
   * far above {@link InstantEvalClassifierLimits.stateTokens} and no request
   * this API builds can reach it, so it is published for completeness rather
   * than enforced.
   */
  readonly totalTokens: number;
  /** Options one category question may offer. */
  readonly maxCategoryOptions: number;
  /**
   * Levels one score question may offer.
   *
   * Far lower than the category ceiling, and not a guess: the live API refuses
   * an eleven-level range with `Too many score levels. Must have at most 10
   * levels.` Published here so the validator refuses an over-wide range where
   * the caller wrote it, instead of every row failing at the provider.
   */
  readonly maxScoreLevels: number;
  /**
   * Tokens held back from the text budget for everything that is neither the
   * text nor the questions: the envelope, and the space the answers need.
   */
  readonly reserveTokens: number;
  /**
   * UTF-8 bytes of judged text per input token, measured against the API.
   *
   * Published rather than assumed, for the same reason the caps are: how text
   * tokenises is a property of the model. The generic rule of four bytes per
   * token is calibrated on English prose, and what a run sends is a
   * conversation transcript in markdown (speaker labels, headings, JSON
   * fragments and punctuation), which tokenises far denser. Measured on real
   * judged transcripts the ratio runs 2.4 to 2.7, so four bytes per token
   * priced a ten thousand conversation run at 8.1M tokens against a real
   * 11.4M.
   */
  readonly bytesPerInputToken: number;
}

/** What the classifier charges, and what the customer is charged. */
export interface InstantEvalPricing {
  /** Output tokens are free on the shipped classifier, so only input is priced. */
  readonly usdPerMillionInputTokens: number;
  /** Multiplier from our cost to the customer's price. */
  readonly markup: number;
}

export interface InstantEvalClassifyRequest {
  /**
   * The project the text is judged for.
   *
   * Not for the judgement, which never sees it, but for the rate: the shared
   * limiter gives each project a share of the deployment's ceiling, and this
   * is what names the share the request draws on.
   */
  readonly projectId: string;
  /**
   * The text to judge, as long as the caller has it.
   *
   * Deliberately not pre-cut. The budget is a property of the classifier, and
   * only the classifier knows how many tokens its own questions cost, so an
   * implementation cuts the text to its own budget and reports having done so
   * through {@link InstantEvalJudgement.isTextTruncated}.
   */
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
