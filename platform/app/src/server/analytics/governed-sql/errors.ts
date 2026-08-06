/**
 * Governed analytics SQL — the failures the endpoints name.
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
 * already maps the two resource ceilings a caller can act on (memory, timeout)
 * onto the platform's existing `query_memory_exceeded` / `query_timeout` codes —
 * so this module deliberately mints no code of its own for them.
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
 * The governed execution path is not provisioned on this deployment.
 *
 * Fail-closed, and the reason this is an error rather than a fallback: without
 * the restricted identity there is no identity to run a customer's SQL as
 * except the application's own, which is exactly the substitution the whole
 * isolation model exists to prevent. Refusing is the only correct answer.
 *
 * `platform` fault, because nothing the caller does fixes it and a 5xx that
 * defaults to `customer` logs a real outage as routine noise.
 */
/**
 * The governed SQL surface is switched off for this project.
 *
 * Distinct from {@link GovernedSqlUnavailableError} on purpose: unavailable is
 * a deployment with no restricted identity to run as (platform fault, 503),
 * while this is a product decision — the feature flag is off for this project
 * — which the caller's administrator can change. `customer` fault, 403, and
 * no incident in the logs.
 */
export class GovernedSqlNotEnabledError extends HandledError {
  declare readonly code: "governed_sql_not_enabled";

  constructor() {
    super(
      "governed_sql_not_enabled",
      "The governed analytics SQL feature is not enabled for this project.",
      {
        httpStatus: 403,
        ...remediation("governed_sql_not_enabled"),
      },
    );
    this.name = "GovernedSqlNotEnabledError";
  }
}

export class GovernedSqlUnavailableError extends HandledError {
  declare readonly code: "governed_sql_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "governed_sql_unavailable",
      "The governed analytics SQL API is not available on this deployment.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("governed_sql_unavailable"),
        ...options,
      },
    );
    this.name = "GovernedSqlUnavailableError";
  }
}

/**
 * The query declares a bound parameter the request supplied no value for.
 *
 * Caught at the gateway rather than left to the database: ClickHouse answers a
 * missing substitution with `UNKNOWN_QUERY_PARAMETER`, which would reach the
 * caller as an unknown 500 for something they can fix in one edit.
 */
export class GovernedSqlParameterMissingError extends HandledError {
  declare readonly code: "governed_sql_parameter_missing";

  constructor(
    /** Declared in the SQL, absent from the request. Sorted, and the caller's own names. */
    missing: readonly string[],
  ) {
    super(
      "governed_sql_parameter_missing",
      "The query declares bound parameters the request did not supply values for.",
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs to know
        // WHICH of five parameters it forgot rather than that one is missing.
        meta: { parameters: missing },
        ...remediation("governed_sql_parameter_missing"),
      },
    );
    this.name = "GovernedSqlParameterMissingError";
  }
}
