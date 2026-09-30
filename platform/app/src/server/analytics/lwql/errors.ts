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
 * the database objects the catalog promises are not there at all for it (the
 * server answers UNKNOWN_TABLE / UNKNOWN_DATABASE for a name the validator
 * already approved, so it cannot be the caller's SQL; see `executor.ts`).
 *
 * An ACCESS_DENIED refusal is deliberately NOT one of the two — that means
 * the objects exist but this identity's grants on one are incomplete, a
 * narrower condition than "not provisioned" that gets its own code and copy:
 * {@link LangWatchQLProvisioningIncompleteError}.
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
 * A name in the query resolves to no column.
 *
 * ClickHouse answers this with UNKNOWN_IDENTIFIER (47), which reached the
 * caller as an unknown 500: the dashboard widget rendered "Something went
 * wrong" and `langwatch chart run` said "An unknown error occurred", for a
 * typo the author fixes in one edit. It cannot be caught earlier than run
 * time, because whether a column exists is not knowable when the chart is
 * saved.
 *
 * `customer` fault and a 400: the SQL is the member's own, and so is the name.
 *
 * The identifier is optional on purpose. It is lifted out of the server's
 * message by a deliberately narrow extractor that fails closed
 * (`unknownIdentifierFromError`), because that message also echoes the
 * submitted query and names internal objects. When it cannot be read with
 * confidence the refusal still arrives coded and actionable, just without the
 * name.
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
 * The execution path IS provisioned — the restricted identity connects, and
 * the catalog's views and tables mostly exist for it — but this query hit a
 * ClickHouse access refusal (`ACCESS_DENIED`) rather than a missing object
 * (`UNKNOWN_TABLE` / `UNKNOWN_DATABASE`).
 *
 * Split from {@link LangWatchQLUnavailableError} on purpose: that code's copy
 * tells the caller to ask their *own* workspace administrator, which is
 * correct for a self-hosted deployment that never provisioned LangWatchQL at
 * all, but wrong here — an access refusal on an otherwise-working deployment
 * means our own grants are incomplete for one catalog object, something no
 * customer's administrator can act on. Sending them to their admin anyway
 * both wastes their time and hides a real provisioning gap behind "config the
 * customer owns."
 *
 * Still `platform` fault, 503, and still fail-closed for the same reason:
 * ACCESS_DENIED for a name the validator already approved cannot be the
 * caller's SQL (see `executor.ts`), and it is not safe to retry as a
 * different identity.
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
 * The finished result is larger than the byte ceiling the API serialises.
 *
 * A hard refusal rather than a silent cut: a JSON body that looks whole but is
 * missing its tail is the worse failure for an analytics caller, so the result
 * is refused outright and the caller told how to bring it under the cap — fewer
 * columns, or a smaller `LIMIT`. The row cap is enforced separately, by the
 * `LIMIT` the service appends to a bare statement; this is the ceiling a query
 * can still exceed inside that row count when its columns are wide.
 *
 * `customer` fault, 413: nothing the platform did causes it and the caller can
 * act on it, so it earns no incident.
 */
export class LangWatchQLResultTooLargeError extends HandledError {
  declare readonly code: "lwql_result_too_large";

  constructor(
    /** The byte ceiling the result exceeded — the caller's target to get under. */
    maxResultBytes: number,
    /**
     * The raw ClickHouse error, present when this was raised from the
     * server's own `max_result_rows` / `max_result_bytes` backstop
     * (TOO_MANY_ROWS_OR_BYTES) rather than the post-fetch byte check — carried
     * for the operator's logs and never relayed to the caller.
     */
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "lwql_result_too_large",
      "The result is larger than this API returns in one response.",
      {
        httpStatus: 413,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs the cap it
        // overshot to decide how much to narrow the query by.
        meta: { maxResultBytes },
        ...remediation("lwql_result_too_large"),
        ...options,
      },
    );
    this.name = "LangWatchQLResultTooLargeError";
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
 * The refusal sentence for exactly the names the request carried, agreeing in
 * number so a single supplied name does not read as "values for dashboard_context_period_start".
 *
 * Built from the supplied names rather than a fixed phrase because the same
 * code covers the two window bounds and the granularity step, and naming the
 * wrong one tells a caller to remove a parameter it never sent.
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
 * The request carried a value for a parameter the surface owns.
 *
 * `dashboard_context_period_start`, `dashboard_context_period_end` and `dashboard_context_granularity_seconds` are supplied by
 * whatever is showing the chart — the dashboard's period and step, the
 * workbench's page period — and a caller that sets one is pinning something
 * that will then ignore the surface it sits on. Refused rather than
 * overwritten, because silently discarding a value a caller sent is how the
 * two-charts-different-periods bug comes back wearing our name.
 *
 * The message names the parameters actually supplied rather than the
 * time-window pair: a caller that sent only the granularity was previously
 * told to remove parameters it had not sent.
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
      suppliedParameterSentence(supplied),
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
 * Which of the two granularity failures this is. They share a code because a
 * caller acts on both the same way — fix the granularity declaration or the
 * step behind it — but they are not the same fact, and a message claiming a
 * type mismatch for a well-typed declaration carrying a fractional step sends
 * the reader to the wrong line.
 */
export type LangWatchQLGranularityFault =
  /** Declared as something other than `UInt32`. */
  | "declared-type"
  /** Declared correctly, but the step supplied is not an offered step. */
  | "step-value";

/**
 * The granularity parameter was declared with a type other than `UInt32`, or
 * the surface supplied a step that is not one of the offered granularity
 * steps.
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
 * The declared window at the requested datapoint granularity would produce
 * more buckets than one governed run may return.
 *
 * The workbench and the REST route refuse here because their callers chose
 * the step; the dashboard owns the range and auto-coarsens instead, arriving
 * here only when even the coarsest offered step still overflows the ceiling.
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
 * A statement declared `dashboard_context_granularity_seconds` without a usable period
 * window for the bucket budget to be computed against -- either bound absent,
 * or present but declared as something other than a date-time.
 *
 * Refused at *save*: without both bounds the surface cannot compute how many
 * buckets a run would produce, so the budget contract would be uncomputable
 * exactly when it matters most -- on the dashboard, where the range is the
 * dashboard's own control. Declaring the two period parameters alongside is
 * the fix, and the schema browser spells them.
 *
 * The two causes get different copy. Telling an author to declare
 * `dashboard_context_period_start` when it is on screen, declared `String`, sends them looking
 * for a line that is already there.
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
 * The statement's app functions would need more distinct keys than one
 * execution may hydrate.
 *
 * A refusal rather than a partial answer, and that is the whole decision. The
 * alternative — hydrate the first thousand keys and leave the rest as raw ids —
 * produces a result that looks complete, carries no marker a consumer could
 * branch on, and is wrong. An analytics caller cannot detect that; they can
 * detect a 422 naming the cap.
 *
 * Remediation is arithmetic: lower the `LIMIT`, aggregate to fewer keys, or
 * page with a keyset predicate on the dataset's time column and trace id.
 */
export class LangWatchQLAppFunctionKeyCapError extends HandledError {
  declare readonly code: "lwql_app_function_key_cap";

  constructor({
    keyKind,
    cap,
    distinct,
    functions,
  }: {
    /** Which cap this is: `trace`, `thread` or `span`. */
    readonly keyKind: string;
    readonly cap: number;
    /** How many distinct keys of that kind the result carried. */
    readonly distinct: number;
    /** The functions of that kind the statement called. Sorted by the caller. */
    readonly functions: readonly string[];
  }) {
    super(
      "lwql_app_function_key_cap",
      "The query asks for more conversations, traces or spans than one run may read. Narrow it with a smaller LIMIT or a coarser grouping.",
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs the number
        // to lower its own LIMIT to, and the functions to know which call cost
        // it. Nothing here is internal: the caps are published by the schema
        // endpoint.
        meta: { keyKind, cap, distinct, functions },
        ...remediation("lwql_app_function_key_cap"),
      },
    );
    this.name = "LangWatchQLAppFunctionKeyCapError";
  }
}

/**
 * The traces the statement's app functions named hold more bytes than one
 * hydration may read.
 *
 * The key cap bounds how many traces a run names; this bounds what they weigh.
 * A thousand keys under the cap can still name a thousand multi-megabyte
 * traces, and reading them all before the result ceiling drops the rows would
 * hold every one of them in memory first. So the reads are chunked and stop at
 * the budget, and the refusal names it, for the same reason the key cap is a
 * refusal rather than a partial answer.
 */
export class LangWatchQLAppFunctionReadBudgetError extends HandledError {
  declare readonly code: "lwql_app_function_read_budget";

  constructor({
    budgetBytes,
    readBytes,
  }: {
    /** The budget one hydration may read, in bytes. */
    readonly budgetBytes: number;
    /** How many bytes had been read when the budget was passed. */
    readonly readBytes: number;
  }) {
    super(
      "lwql_app_function_read_budget",
      "The query asks for more trace content than one run may read. Narrow it with a smaller LIMIT or run it in pages.",
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs the budget
        // to size its pages by. Both numbers are about the caller's own data.
        meta: { budgetBytes, readBytes },
        ...remediation("lwql_app_function_read_budget"),
      },
    );
    this.name = "LangWatchQLAppFunctionReadBudgetError";
  }
}

/**
 * The query ran, but the values its app functions asked for could not be read
 * or computed.
 *
 * `platform` fault and a 503 on purpose: the statement passed every gate and
 * the caller wrote nothing wrong, so this is a failure of ours — and the one
 * thing it must never do is degrade into a result with null columns, which
 * would read as "these conversations are empty".
 */
export class LangWatchQLAppFunctionHydrationFailedError extends HandledError {
  declare readonly code: "lwql_app_function_hydration_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_app_function_hydration_failed",
      "The query ran, but the conversation or trace content it asked for could not be read.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_app_function_hydration_failed"),
        ...options,
      },
    );
    this.name = "LangWatchQLAppFunctionHydrationFailedError";
  }
}

/**
 * The server does not hold the projection UDF behind an app function.
 *
 * ClickHouse answers UNKNOWN_FUNCTION (46), which cannot be the caller's SQL:
 * the validator admits app-function names from the catalog alone, and the
 * catalog is what the provisioning statements are generated from. So the
 * deployment's app functions were never applied — a self-provisioning boot that
 * degraded, or a server provisioned before this feature existed.
 *
 * A sibling of {@link LangWatchQLProvisioningIncompleteError} with its own code
 * because the copy differs: that one is about a dataset's grants, and telling a
 * caller their query "could not read one of its datasets" for a missing
 * function sends whoever reads the log to the wrong place.
 */
export class LangWatchQLAppFunctionUnavailableError extends HandledError {
  declare readonly code: "lwql_app_function_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_app_function_unavailable",
      "The functions this query uses are not available on this deployment yet.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_app_function_unavailable"),
        ...options,
      },
    );
    this.name = "LangWatchQLAppFunctionUnavailableError";
  }
}
