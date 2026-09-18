/**
 * What Instant Evals refuse, and why each one is handled.
 *
 * Both clear the bar of ADR-045: we know the cause and the caller can act on
 * it. Everything else a classification can run into — a dropped socket, a
 * response that is not the contract — stays a plain `Error` and degrades to
 * "unknown" with a trace id.
 *
 * Neither message names the provider, the key, or a host. They ride in a REST
 * response body.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see ../../../../specs/lwql/eval-functions.feature
 */

import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/**
 * The statement would send more text to be judged than one query may.
 *
 * Refused before anything is sent, which is the whole point: the alternative is
 * a caller discovering the size of their query from the bill. The budget bounds
 * a *synchronous* request, where a caller is waiting and a retry costs the
 * whole thing again — the same statement run as a job has no such ceiling,
 * which is what the remediation says.
 *
 * `customer` fault and a 422: the statement is the caller's, and lowering its
 * `LIMIT` or shortening the text it extracts fixes it.
 */
export class InstantEvalQueryBudgetExceededError extends HandledError {
  declare readonly code: "instant_eval_query_budget_exceeded";

  constructor({
    estimatedTokens,
    budget,
  }: {
    /** What the statement's own rows would have sent. */
    readonly estimatedTokens: number;
    readonly budget: number;
  }) {
    super(
      "instant_eval_query_budget_exceeded",
      "This query would judge more text than one request may. Lower the row limit, extract less text per row, or run it as a job.",
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the statement, which needs both
        // numbers to decide how far to lower its LIMIT. Neither is internal —
        // the budget is published by the schema endpoint.
        meta: { estimatedTokens, budget },
        ...remediation("instant_eval_query_budget_exceeded"),
      },
    );
    this.name = "InstantEvalQueryBudgetExceededError";
  }
}

/**
 * The classifier answered nothing for the whole query.
 *
 * `provider` fault and a 503. Not `platform`, because the failing component is
 * one we buy rather than one we run, and an on-call page for it would point at
 * the wrong team; not `customer`, because nothing in the statement is wrong.
 *
 * A classifier that fails for *some* rows is not this: those rows are skipped,
 * their cells are null, and the result says so with a diagnostic. This is the
 * case where every row would carry that skip, and a result full of nulls would
 * read as "nothing matched".
 */
export class InstantEvalClassifierUnavailableError extends HandledError {
  declare readonly code: "instant_eval_classifier_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "instant_eval_classifier_unavailable",
      "The query ran, but the judgements it asked for could not be made right now.",
      {
        httpStatus: 503,
        fault: "provider",
        ...remediation("instant_eval_classifier_unavailable"),
        ...options,
      },
    );
    this.name = "InstantEvalClassifierUnavailableError";
  }
}
