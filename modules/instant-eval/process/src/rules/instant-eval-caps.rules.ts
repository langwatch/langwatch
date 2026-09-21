/**
 * How many rows one run may judge: the default is every plan's, the raised
 * cap is a paid-plan lever rather than a technical one.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import {
  INSTANT_EVAL_DEFAULT_ROW_CAP,
  INSTANT_EVAL_MAX_ROW_CAP,
  InstantEvalRowCapExceededError,
} from "@langwatch/instant-eval-contract";

/** The cap this plan's runs are bounded by. */
export function instantEvalRowCapFor({ isFree }: { readonly isFree: boolean }): number {
  return isFree ? INSTANT_EVAL_DEFAULT_ROW_CAP : INSTANT_EVAL_MAX_ROW_CAP;
}

/**
 * The rows a run gets, or the refusal that says why it gets none. A caller who
 * names no number gets the default rather than the plan's ceiling: a run is
 * charged for what it judges.
 */
export function instantEvalRowLimitOrRefuse({
  requested,
  plan,
}: {
  readonly requested?: number;
  readonly plan: { readonly isFree: boolean; readonly name: string };
}): number {
  const cap = instantEvalRowCapFor({ isFree: plan.isFree });
  if (requested === undefined) return Math.min(cap, INSTANT_EVAL_DEFAULT_ROW_CAP);
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
