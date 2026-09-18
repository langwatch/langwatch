/**
 * What an Instant Eval run refuses, and why each one is handled.
 *
 * All of these clear the bar of ADR-045: we know the cause and the caller can
 * act on it. A dropped socket, a ClickHouse diagnostic or a classifier
 * response that is not the contract stays a plain `Error` and degrades to
 * "unknown" with a trace id.
 *
 * No message names a provider, a key, a host or a table. They ride in a REST
 * response body, and the words a customer reads come from the client
 * presentation registry keyed by `code`.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see ../errors.ts: the two the synchronous judged path raises
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/** The project may not run Instant Evals at all. */
export class InstantEvalNotEnabledError extends HandledError {
  declare readonly code: "instant_eval_not_enabled";

  constructor() {
    super(
      "instant_eval_not_enabled",
      "Instant Evals are not available for this project yet.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("instant_eval_not_enabled"),
      },
    );
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
      // Named consumer: a CLI or agent polling a run it holds an id for, which
      // needs to know which id was refused when it is watching several.
      meta: { runId },
      ...remediation("instant_eval_not_found"),
    });
    this.name = "InstantEvalRunNotFoundError";
  }
}

/**
 * The statement is not one a run can execute.
 *
 * Raised for the two cases the query policy does not cover, because they are
 * properties of running as a *job* rather than of the statement itself: a
 * surface-owned parameter nothing will fill, and a parameter name this surface
 * owns. A statement the policy itself refuses raises the policy's own error,
 * which already names its violations.
 */
export class InstantEvalQueryInvalidError extends HandledError {
  declare readonly code: "instant_eval_query_invalid";

  constructor({
    reason,
    parameters,
    violations,
    reasons,
  }: {
    /** Customer-safe sentence naming what about the statement cannot run. */
    readonly reason: string;
    /** The parameter names at fault, when that is what it is. */
    readonly parameters?: readonly string[];
    /** The policy's own violations, when the policy is what refused it. */
    readonly violations?: unknown;
    readonly reasons?: readonly Error[];
  }) {
    super("instant_eval_query_invalid", reason, {
      httpStatus: 422,
      fault: "customer",
      // Named consumer: the agent that wrote the statement. It edits the named
      // parameters out and resubmits, or reads the policy's violations to see
      // which clause it has to change.
      meta: {
        ...(parameters && parameters.length > 0 ? { parameters } : {}),
        ...(violations === undefined ? {} : { violations }),
      },
      ...remediation("instant_eval_query_invalid"),
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
    needsEvalFunction,
  }: {
    /** Columns a run requires that the statement does not project. */
    readonly missing: readonly string[];
    /** Whether the statement projects no eval function at all. */
    readonly needsEvalFunction: boolean;
  }) {
    super(
      "instant_eval_query_missing_columns",
      needsEvalFunction
        ? "An Instant Eval run needs a statement that projects TraceId and at least one eval function."
        : `An Instant Eval run needs a statement that projects ${missing.join(", ")}.`,
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the statement, which adds the
        // named columns to its projection.
        meta: { missing, needsEvalFunction },
        ...remediation("instant_eval_query_missing_columns"),
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
    /** Rows this plan may judge in one run. */
    readonly cap: number;
    /** The plan the cap belongs to. */
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
        // Named consumer: the CLI and the upgrade dialog, which say what the
        // current plan allows and what a higher one would.
        meta: { requested, cap, plan, maxCap },
        ...remediation("instant_eval_row_cap_exceeded"),
      },
    );
    this.name = "InstantEvalRowCapExceededError";
  }
}

/** The run is over, so there is nothing left to cancel. */
export class InstantEvalAlreadyFinishedError extends HandledError {
  declare readonly code: "instant_eval_already_finished";

  constructor({ runId, status }: { runId: string; status: string }) {
    super(
      "instant_eval_already_finished",
      "That Instant Eval run has already finished.",
      {
        httpStatus: 409,
        fault: "customer",
        // Named consumer: a CLI that raced its own cancel against the run
        // finishing, and reports the state it actually ended in.
        meta: { runId, status },
        ...remediation("instant_eval_already_finished"),
      },
    );
    this.name = "InstantEvalAlreadyFinishedError";
  }
}

/**
 * The estimate could not be made.
 *
 * `platform` fault and a 503: estimating reads the caller's own statement
 * through our own query path, so a failure here is ours. The statement itself
 * was already accepted by the policy before this ran.
 */
export class InstantEvalEstimateUnavailableError extends HandledError {
  declare readonly code: "instant_eval_estimate_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "instant_eval_estimate_unavailable",
      "The size of this run could not be worked out right now.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("instant_eval_estimate_unavailable"),
        ...options,
      },
    );
    this.name = "InstantEvalEstimateUnavailableError";
  }
}
