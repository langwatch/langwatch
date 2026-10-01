/**
 * LangWatchQL execute-path failures; per-query ceilings delegated to query
 * error translator, no new codes minted here.
 */
import { HandledError, remediation } from "@langwatch/handled-error";

/**
 * Feature flag disabled for this project; distinct from unavailable (no
 * identity)—administrator can enable.
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
 * The result is larger than one response carries: refused outright, never cut. Raised from the
 * profile's `max_result_rows` / `max_result_bytes` backstop (TOO_MANY_ROWS_OR_BYTES); the raw
 * driver error rides in `reasons` for the logs only. `customer` fault, 413.
 */
export class LangWatchQLResultTooLargeError extends HandledError {
  declare readonly code: "lwql_result_too_large";

  constructor(maxResultBytes: number, options: { reasons?: readonly Error[] } = {}) {
    super("lwql_result_too_large", "The result is larger than this API returns in one response.", {
      httpStatus: 413,
      fault: "customer",
      meta: { maxResultBytes },
      ...remediation("lwql_result_too_large"),
      ...options,
    });
    this.name = "LangWatchQLResultTooLargeError";
  }
}

/**
 * Executor not provisioned or catalog missing; ACCESS_DENIED is separate
 * ({@link LangWatchQLProvisioningIncompleteError}).
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
 * Query names a nonexistent column; identifier extracted with narrow extractor
 * that fails closed.
 */
export class LangWatchQLUnknownIdentifierError extends HandledError {
  declare readonly code: "lwql_unknown_identifier";

  constructor({
    identifier,
    ...options
  }: {
    /** The unresolvable name, when it could be read from the server's refusal. */
    identifier: string | undefined;
    reasons?: readonly Error[];
  }) {
    super(
      "lwql_unknown_identifier",
      identifier === undefined
        ? "The query names a column that does not exist."
        : `The query names a column that does not exist: ${identifier}.`,
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the workbench, which highlights the offending name,
        // and the CLI, which prints it. Omitted rather than sent as null when
        // it could not be read, so a client can tell "no name" from "the name
        // is the string null".
        ...(identifier === undefined ? {} : { meta: { identifier } }),
        ...remediation("lwql_unknown_identifier"),
        ...options,
      },
    );
    this.name = "LangWatchQLUnknownIdentifierError";
  }
}

/**
 * Access denied on a provisioned executor—our grants incomplete, not customer
 * admin issue.
 */
export class LangWatchQLProvisioningIncompleteError extends HandledError {
  declare readonly code: "lwql_provisioning_incomplete";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_provisioning_incomplete",
      "The LangWatchQL analytics SQL API could not read one of the datasets this query needs.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_provisioning_incomplete"),
        ...options,
      },
    );
    this.name = "LangWatchQLProvisioningIncompleteError";
  }
}

/**
 * The query declares a bound parameter the request supplied no value for. Caught at the
 * gateway, not left to the database: ClickHouse answers a missing substitution with
 * `UNKNOWN_QUERY_PARAMETER`, reaching the caller as an unknown 500 for a one-edit fix.
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
 * The refusal sentence for exactly the names the request carried, agreeing in number so one
 * name doesn't read as plural. Built from the names, not a fixed phrase, since one code covers
 * two window bounds and the granularity step -- naming the wrong one misdirects the caller.
 */
function suppliedParameterSentence(supplied: readonly string[]): string {
  if (supplied.length === 0) {
    return "The request supplied values for parameters the surface sets itself.";
  }
  if (supplied.length === 1) {
    return `The request supplied a value for ${supplied[0]}, which the surface sets itself.`;
  }
  const last = supplied[supplied.length - 1] as string;
  const names = `${supplied.slice(0, -1).join(", ")} and ${last}`;
  return `The request supplied values for ${names}, which the surface sets itself.`;
}

/**
 * Request supplies a value for surface-owned parameter (period bounds or
 * granularity); refused to prevent silent discard.
 */
export class LangWatchQLReservedParameterSuppliedError extends HandledError {
  declare readonly code: "lwql_reserved_parameter_supplied";

  constructor(
    /** The reserved names the request carried. Sorted. */
    supplied: readonly string[],
  ) {
    super("lwql_reserved_parameter_supplied", suppliedParameterSentence(supplied), {
      httpStatus: 400,
      fault: "customer",
      // Named consumer: the parameter editor, which lists the rows to remove,
      // and an agent repairing a request it composed.
      meta: { parameters: supplied },
      ...remediation("lwql_reserved_parameter_supplied"),
    });
    this.name = "LangWatchQLReservedParameterSuppliedError";
  }
}

/**
 * Time-window parameter declared as non-DateTime; caught at save via the
 * shared validator.
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
 * Which of the two granularity failures this is. They share a code -- a caller fixes either
 * the declaration or the step behind it the same way -- but they are not the same fact: a type
 * mismatch message for a well-typed, fractional-step declaration points to the wrong line.
 */
export type LangWatchQLGranularityFault =
  /** Declared as something other than `UInt32`. */
  | "declared-type"
  /** Declared correctly, but the step supplied is not an offered step. */
  | "step-value";

/**
 * Granularity not UInt32 or step not offered; caught at save via shared
 * validator.
 */
export class LangWatchQLReservedGranularityTypeError extends HandledError {
  declare readonly code: "lwql_granularity_parameter_type";

  constructor({
    mistyped,
    fault = "declared-type",
  }: {
    /** The reserved names declared (or valued) wrongly. Sorted. */
    mistyped: readonly string[];
    /** Which failure this is; the declaration one when unstated. */
    fault?: LangWatchQLGranularityFault;
  }) {
    super(
      "lwql_granularity_parameter_type",
      fault === "step-value"
        ? "The datapoint granularity must be one of the offered steps: 1 second, 1 minute, or 1 hour."
        : "The query declares dashboard_context_granularity_seconds with a type that is not UInt32.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: { parameters: mistyped, granularityFault: fault },
        ...remediation("lwql_granularity_parameter_type"),
      },
    );
    this.name = "LangWatchQLReservedGranularityTypeError";
  }
}

/**
 * Window at requested granularity exceeds bucket ceiling; dashboard
 * auto-coarsens, workbench/REST refuse.
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
 * Granularity declared without (or with mistyped) period window; caught at save
 * so bucket budget is computable.
 */
export class LangWatchQLGranularityRequiresTimeWindowError extends HandledError {
  declare readonly code: "lwql_granularity_requires_window";

  constructor({
    absent = [],
    mistyped = [],
  }: {
    /** Period bounds the statement does not declare at all. */
    readonly absent?: readonly string[];
    /** Period bounds declared, but not as a date-time. */
    readonly mistyped?: readonly string[];
  } = {}) {
    super(
      "lwql_granularity_requires_window",
      mistyped.length > 0 && absent.length === 0
        ? "A chart declaring dashboard_context_granularity_seconds must declare dashboard_context_period_start and dashboard_context_period_end as DateTime."
        : "A chart declaring dashboard_context_granularity_seconds must also declare dashboard_context_period_start and dashboard_context_period_end.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the editor, which highlights the declarations to add
        // or rewrite rather than making the author diff the two lists.
        meta: { absent, mistyped },
        ...remediation("lwql_granularity_requires_window"),
      },
    );
    this.name = "LangWatchQLGranularityRequiresTimeWindowError";
  }
}

/**
 * The project answered one statement too many inside the window (HTTP 429).
 * The counter is the project's fixed window, because the compute a query loop
 * burns is invoiced to the project.
 */
export class LangWatchQLRateLimitedError extends HandledError {
  declare readonly code: "lwql_rate_limited";

  constructor(input: { retryAfterSeconds?: number | undefined }) {
    super("lwql_rate_limited", "Too many LangWatchQL queries for this project.", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "LangWatchQLRateLimitedError";
  }
}
