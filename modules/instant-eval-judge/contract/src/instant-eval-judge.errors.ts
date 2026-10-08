/**
 * What the Instant Evals judge refuses. It owns the classifier client and the $1 check (ADR-174
 * decision 13), so these live with it. No message names a provider, key, host or table.
 * @see dev/docs/best_practices/error-handling.md
 */

import { HandledError } from "@langwatch/handled-error";

/**
 * The classifier answered nothing for the whole query. `provider` fault: the
 * failing component is one we buy, and a page for it would reach the wrong
 * team. Some rows failing is not this — those are skipped cells.
 */
export class InstantEvalClassifierUnavailableError extends HandledError {
  declare readonly code: "instant_eval_classifier_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "instant_eval_classifier_unavailable",
      "The query ran, but the judgements it asked for could not be made right now.",
      { httpStatus: 503, fault: "provider", ...options },
    );
    this.name = "InstantEvalClassifierUnavailableError";
  }
}

/**
 * The organization has spent its free Instant Evals allowance. Refused before
 * anything is judged, so the budget is a ceiling rather than a later bill.
 */
export class InstantEvalFreeBudgetExhaustedError extends HandledError {
  declare readonly code: "instant_eval_free_budget_exhausted";

  constructor({ spentUsd, budgetUsd }: { readonly spentUsd: number; readonly budgetUsd: number }) {
    super(
      "instant_eval_free_budget_exhausted",
      `This organization has used its $${budgetUsd} of free Instant Evals. To keep judging, pick another model for this judge or contact us to turn on usage billing.`,
      {
        httpStatus: 402,
        fault: "customer",
        meta: { spentUsd, budgetUsd },
      },
    );
    this.name = "InstantEvalFreeBudgetExhaustedError";
  }
}

export const INSTANT_EVAL_JUDGE_ONLY_MESSAGE =
  "Instant Evals works only as an evaluator judge model.";

/** A save named Instant Evals as the model of something that is not an evaluator judge. */
export class InstantEvalJudgeOnlyModelError extends HandledError {
  declare readonly code: "instant_eval_judge_only_model";

  constructor() {
    super("instant_eval_judge_only_model", INSTANT_EVAL_JUDGE_ONLY_MESSAGE, {
      httpStatus: 422,
      fault: "customer",
    });
    this.name = "InstantEvalJudgeOnlyModelError";
  }
}
