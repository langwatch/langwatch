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
  static readonly code = "lwql_not_enabled" as const;
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
  static readonly code = "lwql_result_too_large" as const;
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
  static readonly code = "lwql_unavailable" as const;
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
  static readonly code = "lwql_unknown_identifier" as const;
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
 * ClickHouse refused the statement as written (an aggregate in WHERE, a type clash) for a
 * reason the static validator cannot see. The fault is the caller's SQL: a 400, never a 500.
 * The refusal echoes the query, so it rides in `reasons` for the logs only.
 */
export class LangWatchQLInvalidQueryError extends HandledError {
  static readonly code = "lwql_invalid_query" as const;
  declare readonly code: "lwql_invalid_query";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("lwql_invalid_query", "The database rejected the query as written.", {
      httpStatus: 400,
      fault: "customer",
      ...remediation("lwql_invalid_query"),
      ...options,
    });
    this.name = "LangWatchQLInvalidQueryError";
  }
}

/**
 * Access denied on a provisioned executor—our grants incomplete, not customer
 * admin issue.
 */
export class LangWatchQLProvisioningIncompleteError extends HandledError {
  static readonly code = "lwql_provisioning_incomplete" as const;
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
  static readonly code = "lwql_parameter_missing" as const;
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
 * A bound parameter's value the server could not read as the type its placeholder
 * declares, such as an ISO `…Z` string on `{start:DateTime64(3)}`. Without this it
 * reached the caller as an unknown 500 for a one-edit fix (WEB-18301).
 */
export class LangWatchQLParameterInvalidError extends HandledError {
  static readonly code = "lwql_parameter_invalid" as const;
  declare readonly code: "lwql_parameter_invalid";

  constructor({
    parameter,
    ...options
  }: {
    /** The placeholder's name, when it could be read from the server's refusal. */
    parameter: string | undefined;
    reasons?: readonly Error[];
  }) {
    super(
      "lwql_parameter_invalid",
      parameter === undefined
        ? "A bound parameter's value does not match the type the query declares for it."
        : `The value of parameter ${parameter} does not match the type the query declares for it.`,
      {
        httpStatus: 400,
        fault: "customer",
        ...(parameter === undefined ? {} : { meta: { parameter } }),
        ...remediation("lwql_parameter_invalid"),
        ...options,
      },
    );
    this.name = "LangWatchQLParameterInvalidError";
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
  static readonly code = "lwql_reserved_parameter_supplied" as const;
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
  static readonly code = "lwql_reserved_parameter_type" as const;
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
  static readonly code = "lwql_granularity_parameter_type" as const;
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
  static readonly code = "lwql_granularity_too_fine" as const;
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
  static readonly code = "lwql_granularity_requires_window" as const;
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
  static readonly code = "lwql_rate_limited" as const;
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

/**
 * An aggregate's run needs every member's LangWatchQL key, and these members have none that can
 * be read, so nothing runs: reading the rest would show a total that silently leaves them out.
 */
export class LangWatchQLMemberKeyMissingError extends HandledError {
  declare readonly code: "lwql_member_key_missing";

  constructor(input: { projectIds: readonly string[]; projectNames?: readonly string[] }) {
    super("lwql_member_key_missing", "A member project of this aggregate cannot be queried.", {
      httpStatus: 503,
      fault: "platform",
      meta: { projectIds: [...input.projectIds], projectNames: [...(input.projectNames ?? [])] },
    });
    this.name = "LangWatchQLMemberKeyMissingError";
  }
}

/**
 * These members are shared up to an end date, and no view can keep a read to before it, so
 * nothing runs: reading the rest would show a total that silently leaves them out.
 */
export class LangWatchQLMemberGrantClosedError extends HandledError {
  declare readonly code: "lwql_member_grant_closed";

  constructor(input: { projectIds: readonly string[]; projectNames?: readonly string[] }) {
    super(
      "lwql_member_grant_closed",
      "A member project of this aggregate is shared up to a date.",
      {
        httpStatus: 422,
        fault: "customer",
        meta: { projectIds: [...input.projectIds], projectNames: [...(input.projectNames ?? [])] },
      },
    );
    this.name = "LangWatchQLMemberGrantClosedError";
  }
}

/**
 * An aggregate reads more members than one LangWatchQL statement may name, refused before any
 * read rather than answered for a part of them.
 */
export class LangWatchQLTooManyMembersError extends HandledError {
  declare readonly code: "lwql_too_many_members";

  constructor(input: { memberCount: number; maxMembers: number }) {
    super("lwql_too_many_members", "This aggregate has too many members to query at once.", {
      httpStatus: 422,
      fault: "customer",
      meta: { memberCount: input.memberCount, maxMembers: input.maxMembers },
    });
    this.name = "LangWatchQLTooManyMembersError";
  }
}

/**
 * A view the read keeps to a window is read as a subquery, and ClickHouse takes no `FINAL` or
 * `SAMPLE` on one. The views already keep one row per key, so `FINAL` adds nothing there.
 */
export class LangWatchQLTableModifierError extends HandledError {
  declare readonly code: "lwql_table_modifier_unsupported";

  constructor(input: { modifiers: readonly string[] }) {
    super("lwql_table_modifier_unsupported", "FINAL and SAMPLE cannot be used on this read.", {
      httpStatus: 400,
      fault: "customer",
      meta: { modifiers: [...input.modifiers] },
    });
    this.name = "LangWatchQLTableModifierError";
  }
}

/**
 * A `WITH` name spelt like a view the read keeps to a window. The rewrite finds views by name, so
 * a name declared in one subquery could hide the view another part of the statement reads.
 */
export class LangWatchQLShadowedViewError extends HandledError {
  declare readonly code: "lwql_view_shadowed";

  constructor(input: { names: readonly string[] }) {
    super("lwql_view_shadowed", "A WITH name cannot repeat a view's name on this read.", {
      httpStatus: 400,
      fault: "customer",
      meta: { names: [...input.names] },
    });
    this.name = "LangWatchQLShadowedViewError";
  }
}

/**
 * The shared LangWatchQL identity is already running as many statements as it
 * may (ClickHouse TOO_MANY_SIMULTANEOUS_QUERIES). Nothing is wrong with the
 * query: the same request succeeds moments later, so it is retryable.
 */
export class LangWatchQLBusyError extends HandledError {
  static readonly code = "lwql_busy" as const;
  declare readonly code: "lwql_busy";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super("lwql_busy", "Too many LangWatchQL queries are running right now.", {
      httpStatus: 503,
      retryable: true,
      fault: "platform",
      ...options,
    });
    this.name = "LangWatchQLBusyError";
  }
}
