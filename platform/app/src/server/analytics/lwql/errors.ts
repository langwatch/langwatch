/**
 * LangWatchQL analytics SQL — the failures the endpoints name.
 *
 * The validator's two refusals already live in `./validation/errors.ts` and are
 * reused rather than restated. These are the ones the *execute* path adds, and
 * both clear the handled bar of ADR-045: we can name the cause and the caller
 * can do something about it.
 *
 * Everything else stays a plain `Error` on purpose. A ClickHouse crash, a
 * dropped socket, a bug in the shaping code — those degrade to "unknown" with a
 * trace id, which is the system working as designed. The one place raw driver
 * failures do become handled errors is `translateClickHouseQueryError`, which
 * already maps the settings profile's per-query ceilings — memory, execution
 * time, and the row/byte scan ceilings — onto the platform's existing
 * `query_memory_exceeded`, `query_timeout` and `query_scan_limit_exceeded`
 * codes, so this module deliberately mints no code of its own for them.
 *
 * The profile's one *aggregate* ceiling, `max_concurrent_queries_for_user`, is
 * not among them: its breach is admission control against the shared identity's
 * total load rather than anything about the submitted query, and it currently
 * degrades to "unknown". Naming it is a follow-up, not an oversight to fix by
 * reaching for a code that means something else.
 *
 * No message here names a host, a credential, a server setting, a physical
 * table, or another tenant. `message` rides in the REST response body.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see ./validation/errors.ts — the refusal half
 */
import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/**
 * The LangWatchQL surface is switched off for this project.
 *
 * Distinct from {@link LangWatchQLUnavailableError} on purpose: unavailable is
 * a deployment with no restricted identity to run as (platform fault, 503),
 * while this is a product decision — the feature flag is off for this project
 * — which the caller's administrator can change. `customer` fault, 403, and
 * no incident in the logs.
 */
export class LangWatchQLNotEnabledError extends HandledError {
  declare readonly code: "lwql_not_enabled";

  constructor() {
    super(
      "lwql_not_enabled",
      "The LangWatchQL analytics SQL feature is not enabled for this project.",
      {
        httpStatus: 403,
        ...remediation("lwql_not_enabled"),
      },
    );
    this.name = "LangWatchQLNotEnabledError";
  }
}

/**
 * The LangWatchQL execution path is not provisioned on this deployment.
 *
 * Two ways to arrive here, one condition: the deployment configured no
 * restricted identity at all (no executor is built), or it configured one but
 * the database objects the catalog promises — the views, the grants — are not
 * there for it (the server answers UNKNOWN_TABLE / UNKNOWN_DATABASE /
 * ACCESS_DENIED for a name the validator already approved, so it cannot be
 * the caller's SQL; see `executor.ts`).
 *
 * Fail-closed, and the reason this is an error rather than a fallback: without
 * the restricted identity there is no identity to run a customer's SQL as
 * except the application's own, which is exactly the substitution the whole
 * isolation model exists to prevent. Refusing is the only correct answer.
 *
 * `platform` fault, because nothing the caller does fixes it and a 5xx that
 * defaults to `customer` logs a real outage as routine noise.
 */
export class LangWatchQLUnavailableError extends HandledError {
  declare readonly code: "lwql_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_unavailable",
      "The LangWatchQL analytics SQL API is not available on this deployment.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_unavailable"),
        ...options,
      },
    );
    this.name = "LangWatchQLUnavailableError";
  }
}

/**
 * The query declares a bound parameter the request supplied no value for.
 *
 * Caught at the gateway rather than left to the database: ClickHouse answers a
 * missing substitution with `UNKNOWN_QUERY_PARAMETER`, which would reach the
 * caller as an unknown 500 for something they can fix in one edit.
 */
export class LangWatchQLParameterMissingError extends HandledError {
  declare readonly code: "lwql_parameter_missing";

  constructor(
    /** Declared in the SQL, absent from the request. Sorted, and the caller's own names. */
    missing: readonly string[],
  ) {
    super(
      "lwql_parameter_missing",
      "The query declares bound parameters the request did not supply values for.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs to know
        // WHICH of five parameters it forgot rather than that one is missing.
        meta: { parameters: missing },
        ...remediation("lwql_parameter_missing"),
      },
    );
    this.name = "LangWatchQLParameterMissingError";
  }
}

/**
 * The request carried a value for a parameter the surface owns.
 *
 * `period_start` and `period_end` are supplied by whatever is showing the chart
 * — the dashboard's period, the workbench's page period — and a caller that
 * sets one is pinning a window that will then ignore the surface it sits on.
 * Refused rather than overwritten, because silently discarding a value a caller
 * sent is how the two-charts-different-periods bug comes back wearing our name.
 *
 * @see ./timeWindow.ts — the contract this enforces
 */
export class LangWatchQLReservedParameterSuppliedError extends HandledError {
  declare readonly code: "lwql_reserved_parameter_supplied";

  constructor(
    /** The reserved names the request carried. Sorted. */
    supplied: readonly string[],
  ) {
    super(
      "lwql_reserved_parameter_supplied",
      "The request supplied values for time-window parameters the surface sets itself.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the parameter editor, which lists the rows to remove,
        // and an agent repairing a request it composed.
        meta: { parameters: supplied },
        ...remediation("lwql_reserved_parameter_supplied"),
      },
    );
    this.name = "LangWatchQLReservedParameterSuppliedError";
  }
}

/**
 * A reserved time-window parameter was declared as something other than a
 * ClickHouse date-time.
 *
 * Raised while validating rather than while running, so a chart is refused at
 * *save* for the same reason it would be refused at render — the two go through
 * one validator — and a member finds out while they are still looking at the
 * statement.
 */
export class LangWatchQLReservedParameterTypeError extends HandledError {
  declare readonly code: "lwql_reserved_parameter_type";

  constructor(
    /** The reserved names declared with the wrong type. Sorted. */
    mistyped: readonly string[],
  ) {
    super(
      "lwql_reserved_parameter_type",
      "The query declares a time-window parameter with a type that is not a date-time.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the editor, which says which declaration to rewrite.
        meta: { parameters: mistyped },
        ...remediation("lwql_reserved_parameter_type"),
      },
    );
    this.name = "LangWatchQLReservedParameterTypeError";
  }
}

/**
 * The granularity parameter was declared with a type other than `UInt32`, or
 * the surface supplied a step that is not a positive whole number of
 * seconds.
 *
 * A sibling of {@link LangWatchQLReservedParameterTypeError} -- from the
 * caller's side both read as "you declared a surface-owned parameter with the
 * wrong type" -- but it carries its own code, so the copy can name what this
 * declaration must be (`UInt32`) instead of the window's date-time advice.
 *
 * Raised while validating rather than while running, so a chart is refused
 * at *save* for the same reason it would be refused at render.
 */
export class LangWatchQLReservedGranularityTypeError extends HandledError {
  declare readonly code: "lwql_granularity_parameter_type";

  constructor(
    /** The reserved names declared (or valued) wrongly. Sorted. */
    mistyped: readonly string[],
  ) {
    super(
      "lwql_granularity_parameter_type",
      "The query declares period_granularity_seconds with a type that is not UInt32.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: { parameters: mistyped },
        ...remediation("lwql_granularity_parameter_type"),
      },
    );
    this.name = "LangWatchQLReservedGranularityTypeError";
  }
}

/**
 * The declared window at the requested datapoint granularity would produce
 * more buckets than one governed run may return.
 *
 * The workbench and the REST route refuse here because their callers chose
 * the step; the dashboard does not arrive here -- it owns the range, so it
 * auto-coarsens instead and says so.
 *
 * Remediation is arithmetic, not retrying: widen the step until the bucket
 * count fits the ceiling, or narrow the window.
 */
export class LangWatchQLGranularityTooFineError extends HandledError {
  declare readonly code: "lwql_granularity_too_fine";

  constructor({
    requestedGranularitySeconds,
    windowSeconds,
    maxBuckets,
  }: {
    requestedGranularitySeconds: number;
    windowSeconds: number;
    maxBuckets: number;
  }) {
    super(
      "lwql_granularity_too_fine",
      "The requested datapoint granularity produces more buckets than the selected period allows.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: {
          requestedGranularitySeconds,
          windowSeconds,
          maxBuckets,
        },
        ...remediation("lwql_granularity_too_fine"),
      },
    );
    this.name = "LangWatchQLGranularityTooFineError";
  }
}

/**
 * A statement declared `period_granularity_seconds` without declaring the
 * period window the bucket budget is computed against.
 *
 * Refused at *save*: without both bounds the surface cannot compute how many
 * buckets a run would produce, so the budget contract would be uncomputable
 * exactly when it matters most -- on the dashboard, where the range is the
 * dashboard's own control. Declaring the two period parameters alongside is
 * the fix, and the schema browser spells them.
 */
export class LangWatchQLGranularityRequiresTimeWindowError extends HandledError {
  declare readonly code: "lwql_granularity_requires_window";

  constructor() {
    super(
      "lwql_granularity_requires_window",
      "A chart declaring period_granularity_seconds must also declare period_start and period_end.",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("lwql_granularity_requires_window"),
      },
    );
    this.name = "LangWatchQLGranularityRequiresTimeWindowError";
  }
}
