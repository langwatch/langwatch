/**
 * How many rows one run may judge.
 *
 * Two numbers and one rule, in one place because three callers read them: the
 * create path, the estimate, and the refusal's own copy.
 *
 * The default is the same on every plan, which is the point of it: ten
 * thousand conversations is a real answer to a real question and it costs a
 * quarter of a dollar at the shipped rate, so the feature can be tried
 * without buying anything first. The raised cap is a paid-plan lever
 * rather than a technical one: a hundred thousand rows is seventeen minutes of
 * the platform's classifier budget, and a free tier that could take it would be
 * a free tier that could take all of it.
 *
 * Metering the spend and the free budget are not implemented here. What is here
 * is the ceiling and the refusal that names what lifts it.
 *
 * @see ./errors.ts
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { InstantEvalRowCapExceededError } from "./errors";

/** Rows a run judges when the caller asks for no particular number. */
export const INSTANT_EVAL_DEFAULT_ROW_CAP = 10_000;

/** Rows a run may judge at most, on any plan. */
export const INSTANT_EVAL_MAX_ROW_CAP = 100_000;

/** Rows a sample re-reads at most. */
export const INSTANT_EVAL_SAMPLE_CEILING = 25;

/** Judgements one results page carries at most. */
export const INSTANT_EVAL_RESULTS_CEILING = 1_000;

/** The cap this plan's runs are bounded by. */
export function instantEvalRowCapFor({
  isFree,
}: {
  readonly isFree: boolean;
}): number {
  return isFree ? INSTANT_EVAL_DEFAULT_ROW_CAP : INSTANT_EVAL_MAX_ROW_CAP;
}

/**
 * The rows a run gets, or the refusal that says why it gets none.
 *
 * A caller who asks for no particular number gets the default rather than the
 * plan's ceiling: a run is charged for what it judges, so silently taking a
 * paid plan's whole hundred thousand rows because the field was absent would
 * bill ten times what the caller meant to ask for.
 */
export function instantEvalRowLimitOrRefuse({
  requested,
  plan,
}: {
  readonly requested?: number;
  readonly plan: { readonly isFree: boolean; readonly name: string };
}): number {
  const cap = instantEvalRowCapFor({ isFree: plan.isFree });
  if (requested === undefined) {
    return Math.min(cap, INSTANT_EVAL_DEFAULT_ROW_CAP);
  }
  if (requested > cap) {
    throw new InstantEvalRowCapExceededError({
      requested,
      cap,
      plan: plan.name,
      maxCap: INSTANT_EVAL_MAX_ROW_CAP,
    });
  }
  return requested;
}
