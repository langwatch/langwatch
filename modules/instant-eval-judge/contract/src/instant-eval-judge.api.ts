/**
 * The Instant Evals judge, a dependency leaf that calls no peer (ADR-174 decision 13), and what a
 * judge is asked and answers, portable because the run, the wire and the judge all name them.
 *
 * @see modules/instant-eval/specs/classifier.feature
 */

import { moduleApi } from "@langwatch/module";
import { z } from "zod";

/**
 * The judge call and the cloud classifier behind it (ADR-174 decisions 10, 13). It calls no
 * peer: what it checks before each call comes from its own copies of its peers' facts.
 */
export interface InstantEvalJudgeApi {
  /**
   * Whether this deployment holds LangWatch's classifier key. A peer Api cannot be called at
   * startup, so Instant Evals asks this on its first call to choose the key or Connect.
   */
  isClassifierConfigured(): Promise<boolean>;
  /**
   * One classification with LangWatch's key, priced by nobody: runs and judged queries record
   * theirs through `recordSpend`, and the search bar records none (ADR-144). Skips as
   * `classifier_not_configured` where there is no key.
   */
  classify(input: InstantEvalClassification): Promise<InstantEvalJudgement>;
  /**
   * One metered judge call: unknown project, cloud only, budget, classify, price, priced event.
   * A refusal is returned, never thrown, and calls no classifier.
   */
  judge(input: InstantEvalJudgeCall): Promise<InstantEvalJudgeAnswer>;
  /**
   * Prices and records what an Instant Evals run or judged query spent, under the organization
   * the caller resolved, so no project is looked up (ADR-174 decision 13). Throws when the priced
   * fact cannot be stored, so a run's finish retries onto the same request id.
   */
  recordSpend(input: InstantEvalJudgeSpendRecord): Promise<void>;
}

export const InstantEvalJudgeApi = moduleApi<InstantEvalJudgeApi>()("instant-eval-judge");

/** One text and every question about it, judged for a project. */
export interface InstantEvalClassification {
  /** Names the share of the rate the request draws on; the classifier never sees it. */
  readonly projectId: string;
  /** As long as the caller has it: the classifier cuts it to its own budget. */
  readonly text: string;
  readonly questions: readonly InstantEvalQuestion[];
  readonly signal?: AbortSignal;
}

/** The model a judge's settings name to be answered by Instant Evals (ADR-174 decision 11). */
export const INSTANT_EVAL_JUDGE_MODEL_ID = "langwatch/instant-evals";

/** One judge call. A signal stops the classifier, never the record of what it was paid. */
export interface InstantEvalJudgeCall extends InstantEvalClassification {
  /** The evaluation's retry key: the same key gives the same spend id (ADR-174 decision 9). */
  readonly requestKey?: string;
}

/** What one Instant Evals run or judged query spent, as its caller records it. */
export interface InstantEvalJudgeSpendRecord {
  /** The organization the caller resolved; the judge never looks the project up for it. */
  readonly organizationId: string;
  readonly projectId: string;
  /** The run's own id for every attempt of a run, a fresh id for a query (ADR-174 decision 17). */
  readonly requestId: string;
  /** Input tokens the classifier billed for. Zero records nothing. */
  readonly inputTokens: number;
  /** Classifications made, one per judged text. */
  readonly requests: number;
  /** The run the spend belongs to, when it belongs to one. */
  readonly runId?: string;
  /** Epoch milliseconds. */
  readonly occurredAt: number;
}

/** Why a judge call was refused before the classifier was called (ADR-174 decision 7). */
export const INSTANT_EVAL_JUDGE_REFUSAL_CODES = [
  "instant_eval_project_unknown",
  "classifier_not_configured",
  "instant_eval_free_budget_exhausted",
] as const;

export type InstantEvalJudgeRefusalCode = (typeof INSTANT_EVAL_JUDGE_REFUSAL_CODES)[number];

/** A judgement and what it was priced at, or a refusal naming its code. */
export type InstantEvalJudgeAnswer =
  | Readonly<{
      outcome: "judged";
      judgement: InstantEvalJudgement;
      /** The customer price in USD, which the evaluation's cost carries. Zero for no tokens. */
      priceUsd: number;
    }>
  | Readonly<{ outcome: "refused"; code: InstantEvalJudgeRefusalCode; message: string }>;

/** What a question asks for, which decides how its answer is read. */
export const INSTANT_EVAL_QUESTION_KINDS = ["boolean", "score", "category"] as const;

export type InstantEvalQuestionKind = (typeof INSTANT_EVAL_QUESTION_KINDS)[number];

/** A yes-or-no question, answered with a calibrated probability. */
const instantEvalBooleanQuestionSchema = z
  .object({
    id: z.string(),
    kind: z.literal("boolean"),
    instructions: z.string(),
    /** What counts as yes, then what counts as no. A boundary has two sides. */
    criteria: z.tuple([z.string(), z.string()]).readonly().optional(),
  })
  .readonly();

export type InstantEvalBooleanQuestion = z.infer<typeof instantEvalBooleanQuestionSchema>;

/** A rating on a whole-numbered scale, answered with a weighted mean. */
const instantEvalScoreQuestionSchema = z
  .object({
    id: z.string(),
    kind: z.literal("score"),
    instructions: z.string(),
    /** Inclusive bounds. Every whole number between them is a level. */
    range: z.object({ min: z.number(), max: z.number() }).readonly(),
  })
  .readonly();

export type InstantEvalScoreQuestion = z.infer<typeof instantEvalScoreQuestionSchema>;

/** One named option out of a closed set. */
const instantEvalCategoryQuestionSchema = z
  .object({
    id: z.string(),
    kind: z.literal("category"),
    instructions: z.string(),
    options: z.array(z.object({ name: z.string(), description: z.string() }).readonly()).readonly(),
  })
  .readonly();

export type InstantEvalCategoryQuestion = z.infer<typeof instantEvalCategoryQuestionSchema>;

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

/** What the judge takes, and what it answers with. */
export interface InstantEvalClassifierLimits {
  /** Text and questions together may not exceed this. */
  readonly stateTokens: number;
  readonly totalTokens: number;
  readonly maxCategoryOptions: number;
  readonly maxScoreLevels: number;
  /** Covers the envelope and the space the answers need. */
  readonly reserveTokens: number;
  /** Transcripts tokenise denser than prose; measured, not the generic four. */
  readonly bytesPerInputToken: number;
  /** The densest judged text measured (JSON-heavy digests); such text is fitted at this ratio. */
  readonly fitBytesPerInputToken: number;
  /** The densest markdown transcript measured; a transcript is cut to fit at this ratio. */
  readonly transcriptFitBytesPerInputToken: number;
  /** Below any judged text measured; the too-large retry cuts at this ratio. */
  readonly retryBytesPerInputToken: number;
}

/** The shipped classifier's caps, measured against the live API. */
export const INSTANT_EVAL_CLASSIFIER_LIMITS: InstantEvalClassifierLimits = {
  stateTokens: 32_000,
  totalTokens: 64_000,
  maxCategoryOptions: 255,
  maxScoreLevels: 10,
  reserveTokens: 768,
  bytesPerInputToken: 2.7,
  fitBytesPerInputToken: 2,
  transcriptFitBytesPerInputToken: 2.4,
  retryBytesPerInputToken: 1.5,
};
