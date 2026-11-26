/**
 * What one routed call cost us, in integer nano-USD, from the tokens it reported and the
 * backend's configured price. The customer price is the summed cost times the markup.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  instantEvalCostUsd,
  type InstantEvalJudgeJob,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalQuestion,
  instantEvalTextBudget,
  isInstantEvalJudgeLlmKind,
  NANO_USD_PER_USD,
} from "@langwatch/instant-eval-judge-contract";

import { prepareInstantEvalText } from "./instant-eval-classifier-text.rules.ts";
import { instantEvalLlmJudgePromptOf } from "./instant-eval-llm-judge-wire.rules.ts";
import {
  instantEvalLlmContentBudgetTokensOf,
  instantEvalLlmJudgeMaxOutputTokensOf,
} from "./instant-eval-llm-tool-call-wire.rules.ts";

const NANO_USD_PER_MILLION_TOKENS_PER_USD = 1_000;

/** The call's cost, or `unpriced` when the backend has no configured price. */
type InstantEvalJudgeCallCost =
  | Readonly<{ outcome: "priced"; costNanoUsd: number }>
  | Readonly<{ outcome: "unpriced" }>;

export function instantEvalJudgeCallCostOf({
  backend,
  inputTokens,
  outputTokens,
  pricing,
}: {
  backend: string;
  inputTokens: number;
  outputTokens: number;
  pricing: InstantEvalJudgeRoutePricing;
}): InstantEvalJudgeCallCost {
  const price = pricing.backends[backend];
  if (!price) return { outcome: "unpriced" };
  const rate =
    price.longContext && inputTokens > price.longContext.aboveInputTokens
      ? price.longContext
      : price;
  // USD per million tokens is nano-USD per thousand tokens.
  const nano =
    (inputTokens * rate.usdPerMillionInputTokens + outputTokens * rate.usdPerMillionOutputTokens) *
    NANO_USD_PER_MILLION_TOKENS_PER_USD;
  return { outcome: "priced", costNanoUsd: Math.round(nano) };
}

/** What a judgement's calls have spent so far: the input tokens and their cost. */
export type InstantEvalJudgeSpend = Readonly<{ inputTokens: number; costNanoUsd: number }>;

/**
 * The spend after one more call, and whether that call had no price. A call that billed no
 * tokens changes nothing; an unpriced one adds its tokens and no cost, for its caller to flag.
 */
export function instantEvalJudgeSpendAfterCall({
  spend,
  backend,
  inputTokens,
  outputTokens,
  pricing,
}: {
  spend: InstantEvalJudgeSpend;
  backend: string;
  inputTokens: number;
  outputTokens: number;
  pricing: InstantEvalJudgeRoutePricing;
}): Readonly<{ spend: InstantEvalJudgeSpend; isUnpriced: boolean }> {
  if (inputTokens <= 0 && outputTokens <= 0) return { spend, isUnpriced: false };
  const cost = instantEvalJudgeCallCostOf({ backend, inputTokens, outputTokens, pricing });
  const costNanoUsd = cost.outcome === "priced" ? cost.costNanoUsd : 0;
  return {
    spend: {
      inputTokens: spend.inputTokens + inputTokens,
      costNanoUsd: spend.costNanoUsd + costNanoUsd,
    },
    isUnpriced: cost.outcome === "unpriced",
  };
}

/**
 * The hosted classifier's cost for a call the router does not route: its routed price, else the
 * published rate, so every judgement a routed call returns carries a cost.
 */
export function instantEvalJudgeClassifierCostOf({
  table,
  pricing,
  inputTokens,
  outputTokens = 0,
}: {
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  inputTokens: number;
  /** Priced at the routed output rate; the published rate prices input alone. */
  outputTokens?: number;
}): number {
  for (const [backend, config] of Object.entries(table.backends)) {
    if (config.kind !== "jev") continue;
    const cost = instantEvalJudgeCallCostOf({ backend, inputTokens, outputTokens, pricing });
    if (cost.outcome === "priced") return cost.costNanoUsd;
  }
  return Math.round(instantEvalCostUsd({ inputTokens }) * NANO_USD_PER_USD);
}

/**
 * Tokens one send may bill beyond the UTF-8 bytes it is built from (a token is at least one
 * byte): message framing and a request's fixed part, which the classifier measured at about 200.
 */
const INSTANT_EVAL_JUDGE_SEND_SLACK_TOKENS = 1_024;

/**
 * Output tokens a decision model is allowed per question: it answers a probability or a label,
 * and Decisions reports none. Priced only where the pricing sets an output rate for it.
 */
const INSTANT_EVAL_JUDGE_DECISION_OUTPUT_TOKENS_PER_QUESTION = 256;

/**
 * The most one send can cost us, in nano-USD: a token per byte of the text as its channel fits it,
 * at the dearer rate, plus an output cap. LLM and Decisions sends are per question, Jev's for all.
 * Infinite for an unpriced backend, so a ceiling never sends it (ADR-190 decision 13).
 */
export function instantEvalJudgeSendWorstCaseNanoUsd({
  backend,
  table,
  pricing,
  job,
  text,
  questions,
}: {
  backend: string;
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  job: InstantEvalJudgeJob;
  /** The longest text the send may carry, before its channel fits it. */
  text: string;
  questions: readonly InstantEvalQuestion[];
}): number {
  const config = table.backends[backend];
  const price = pricing.backends[backend];
  if (!config || !price) return Number.POSITIVE_INFINITY;
  const rates = price.longContext ? [price, price.longContext] : [price];
  const inputRate = Math.max(...rates.map((rate) => rate.usdPerMillionInputTokens));
  const outputRate = Math.max(...rates.map((rate) => rate.usdPerMillionOutputTokens));
  const costOf = ({ bytes, outputTokens }: { bytes: number; outputTokens: number }) =>
    ((bytes + INSTANT_EVAL_JUDGE_SEND_SLACK_TOKENS) * inputRate + outputTokens * outputRate) *
    NANO_USD_PER_MILLION_TOKENS_PER_USD;
  if (isInstantEvalJudgeLlmKind(config.kind)) {
    const outputTokens = instantEvalLlmJudgeMaxOutputTokensOf({
      wire: config.kind,
      reasoningEffort: config.reasoningEffort,
      maxOutputTokens: config.maxOutputTokens,
    });
    const fitted = prepareInstantEvalText({
      text,
      budgetTokens: instantEvalLlmContentBudgetTokensOf(config.kind),
    }).text;
    return ceilNanoUsd(
      sumOf(
        questions.map((question) => {
          const { system, user, tool } = instantEvalLlmJudgePromptOf({
            job,
            question,
            text: fitted,
          });
          const bytes = utf8BytesOf(system) + utf8BytesOf(user) + utf8BytesOf(JSON.stringify(tool));
          return costOf({ bytes, outputTokens });
        }),
      ),
    );
  }
  const sends = config.kind === "jev" ? [questions] : questions.map((question) => [question]);
  return ceilNanoUsd(
    sumOf(
      sends.map((asked) =>
        costOf({
          bytes:
            fittedClassifierBytesOf({ text, questions: asked }) +
            utf8BytesOf(JSON.stringify(asked)),
          outputTokens: asked.length * INSTANT_EVAL_JUDGE_DECISION_OUTPUT_TOKENS_PER_QUESTION,
        }),
      ),
    ),
  );
}

/** The hosted classifier's worst case for a call the router does not route, priced as it is. */
export function instantEvalJudgeClassifierWorstCaseNanoUsd({
  table,
  pricing,
  job,
  text,
  questions,
}: {
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  job: InstantEvalJudgeJob;
  text: string;
  questions: readonly InstantEvalQuestion[];
}): number {
  const priced = Object.entries(table.backends).find(
    ([backend, config]) => config.kind === "jev" && pricing.backends[backend],
  );
  if (priced) {
    const [backend] = priced;
    return instantEvalJudgeSendWorstCaseNanoUsd({ backend, table, pricing, job, text, questions });
  }
  const bytes =
    fittedClassifierBytesOf({ text, questions }) + utf8BytesOf(JSON.stringify(questions));
  const inputTokens = bytes + INSTANT_EVAL_JUDGE_SEND_SLACK_TOKENS;
  return ceilNanoUsd(instantEvalCostUsd({ inputTokens }) * NANO_USD_PER_USD);
}

const utf8 = new TextEncoder();

/**
 * The text's bytes as the classifier and Decisions channels fit it to the questions' budget: a
 * send whose questions leave no budget sends nothing. A Decisions send asked one question of
 * several fits at that one question's budget, never less than its channel keeps.
 */
function fittedClassifierBytesOf({
  text,
  questions,
}: {
  text: string;
  questions: readonly InstantEvalQuestion[];
}): number {
  const budgetTokens = instantEvalTextBudget({ questions });
  if (budgetTokens === 0) return 0;
  return utf8BytesOf(prepareInstantEvalText({ text, budgetTokens }).text);
}

function utf8BytesOf(text: string): number {
  return utf8.encode(text).length;
}

/** Up to a whole nano-USD, after dropping float noise below a thousandth of one. */
function ceilNanoUsd(nanoUsd: number): number {
  return Math.ceil(Math.round(nanoUsd * 1_000) / 1_000);
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
