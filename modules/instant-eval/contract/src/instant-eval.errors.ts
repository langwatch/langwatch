/**
 * What Instant Evals refuse. Each clears ADR-045: we know the cause and the
 * caller can act on it. No message names a provider, key, host or table.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";

/**
 * The statement would send more text to be judged than one synchronous
 * request may. Refused before anything is sent: the alternative is a caller
 * discovering the size of their query from the bill.
 */
export class InstantEvalQueryBudgetExceededError extends HandledError {
  declare readonly code: "instant_eval_query_budget_exceeded";

  constructor({
    estimatedTokens,
    budget,
  }: {
    readonly estimatedTokens: number;
    readonly budget: number;
  }) {
    super(
      "instant_eval_query_budget_exceeded",
      "This query would judge more text than one request may. Lower the row limit, extract less text per row, or run it as a job.",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { estimatedTokens, budget },
      },
    );
    this.name = "InstantEvalQueryBudgetExceededError";
  }
}

/** The questions alone fill the judge's state, leaving no room for any text. */
export class InstantEvalQuestionsTooLongError extends HandledError {
  declare readonly code: "instant_eval_questions_too_long";

  constructor({
    questionTokens,
    stateTokens,
  }: {
    readonly questionTokens: number;
    readonly stateTokens: number;
  }) {
    super(
      "instant_eval_questions_too_long",
      "The questions are too long to leave room for any text to judge. Shorten them, or ask fewer of them at once.",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { questionTokens, stateTokens },
      },
    );
    this.name = "InstantEvalQuestionsTooLongError";
  }
}

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
      "This organization has used its free Instant Evals allowance. Upgrade to a paid plan to keep judging.",
      {
        httpStatus: 402,
        fault: "customer",
        meta: { spentUsd, budgetUsd },
      },
    );
    this.name = "InstantEvalFreeBudgetExhaustedError";
  }
}

/** The project may not run Instant Evals at all. */
export class InstantEvalNotEnabledError extends HandledError {
  declare readonly code: "instant_eval_not_enabled";

  constructor() {
    super("instant_eval_not_enabled", "Instant Evals are not available for this project yet.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "InstantEvalNotEnabledError";
  }
}

/** No run of this project has that id. */
export class InstantEvalRunNotFoundError extends HandledError {
  declare readonly code: "instant_eval_not_found";

  constructor({ runId }: { runId: string }) {
    super("instant_eval_not_found", "That Instant Eval run does not exist.", {
      httpStatus: 404,
      fault: "customer",
      meta: { runId },
    });
    this.name = "InstantEvalRunNotFoundError";
  }
}

/**
 * The statement is not one a run can execute: a surface-owned parameter
 * nothing will fill, or a parameter name this surface owns. A statement the
 * query policy refuses raises the policy's own error instead.
 */
export class InstantEvalQueryInvalidError extends HandledError {
  declare readonly code: "instant_eval_query_invalid";

  constructor({
    reason,
    parameters,
    fields,
    violations,
    reasons,
  }: {
    /** Customer-safe sentence naming what about the statement cannot run. */
    readonly reason: string;
    readonly parameters?: readonly string[];
    /** Which of `target`, `filter`, `questions` a shorthand must rewrite. */
    readonly fields?: readonly string[];
    readonly violations?: unknown;
    readonly reasons?: readonly Error[];
  }) {
    super("instant_eval_query_invalid", reason, {
      httpStatus: 422,
      fault: "customer",
      meta: {
        ...(parameters && parameters.length > 0 ? { parameters } : {}),
        ...(fields && fields.length > 0 ? { fields } : {}),
        ...(violations === undefined ? {} : { violations }),
      },
      ...(reasons ? { reasons } : {}),
    });
    this.name = "InstantEvalQueryInvalidError";
  }
}

/** The statement does not project what a run needs to judge and record. */
export class InstantEvalQueryMissingColumnsError extends HandledError {
  declare readonly code: "instant_eval_query_missing_columns";

  constructor({
    missing,
    isEvalFunctionMissing,
  }: {
    readonly missing: readonly string[];
    readonly isEvalFunctionMissing: boolean;
  }) {
    super(
      "instant_eval_query_missing_columns",
      isEvalFunctionMissing
        ? "An Instant Eval run needs a statement that projects TraceId and at least one eval function."
        : `An Instant Eval run needs a statement that projects ${missing.join(", ")}.`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { missing, isEvalFunctionMissing },
      },
    );
    this.name = "InstantEvalQueryMissingColumnsError";
  }
}

/** The run asked for more rows than this plan may judge. */
export class InstantEvalRowCapExceededError extends HandledError {
  declare readonly code: "instant_eval_row_cap_exceeded";

  constructor({
    requested,
    cap,
    plan,
    maxCap,
  }: {
    readonly requested: number;
    readonly cap: number;
    readonly plan: string;
    /** The highest cap any plan offers, so a caller knows what upgrading buys. */
    readonly maxCap: number;
  }) {
    super(
      "instant_eval_row_cap_exceeded",
      requested > maxCap
        ? "That is more rows than one Instant Eval run may judge."
        : "That is more rows than this plan may judge in one Instant Eval run.",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { requested, cap, plan, maxCap },
      },
    );
    this.name = "InstantEvalRowCapExceededError";
  }
}

/** The run is over, so there is nothing left to cancel. */
export class InstantEvalAlreadyFinishedError extends HandledError {
  declare readonly code: "instant_eval_already_finished";

  constructor({ runId, status }: { runId: string; status: string }) {
    super("instant_eval_already_finished", "That Instant Eval run has already finished.", {
      httpStatus: 409,
      fault: "customer",
      // Spelled as the run's own wire status, so a reader compares like with like.
      meta: { runId, status: status.toLowerCase() },
    });
    this.name = "InstantEvalAlreadyFinishedError";
  }
}

/**
 * The estimate could not be made. `platform` fault: estimating reads the
 * caller's own statement through our query path, so a failure here is ours.
 */
export class InstantEvalEstimateUnavailableError extends HandledError {
  declare readonly code: "instant_eval_estimate_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "instant_eval_estimate_unavailable",
      "The size of this run could not be worked out right now.",
      { httpStatus: 503, fault: "platform", ...options },
    );
    this.name = "InstantEvalEstimateUnavailableError";
  }
}
