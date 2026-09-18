/**
 * What an Instant Eval costs us, and what it costs the customer.
 *
 * Two numbers and one multiplication, in one place because they are read from
 * three: the estimate a caller makes before spending anything, the cost row
 * written after a query, and the copy that tells a customer what they paid.
 *
 * Output tokens are free on the shipped classifier, so only input is priced.
 * That is a property of the provider and is published through
 * {@link InstantEvalPricing} rather than assumed here, so a classifier that
 * charges for output can say so without changing any caller.
 *
 * @see ./classifier.ts
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

import type { InstantEvalPricing } from "./classifier";

/**
 * The shipped rate: TypeSafe Jev, jev-1.13, measured September 2026.
 *
 * The markup is the platform's margin on a capability it buys wholesale and
 * meters per use, and it applies to every plan.
 */
export const INSTANT_EVAL_PRICING: InstantEvalPricing = {
  usdPerMillionInputTokens: 0.042,
  markup: 1.3,
};

const TOKENS_PER_MILLION = 1_000_000;

/** What the classifier charged us for these input tokens. */
export function instantEvalCostUsd({
  inputTokens,
  pricing = INSTANT_EVAL_PRICING,
}: {
  inputTokens: number;
  pricing?: InstantEvalPricing;
}): number {
  if (inputTokens <= 0) return 0;
  return (inputTokens / TOKENS_PER_MILLION) * pricing.usdPerMillionInputTokens;
}

/** What the customer is charged for a cost of ours. */
export function instantEvalPriceUsd({
  costUsd,
  pricing = INSTANT_EVAL_PRICING,
}: {
  costUsd: number;
  pricing?: InstantEvalPricing;
}): number {
  return costUsd * pricing.markup;
}
