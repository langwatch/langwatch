/**
 * Governed analytics SQL — how a refusal crosses the API boundary.
 *
 * The validator returns a result; it never throws for a rejection. These are
 * what a caller of the validator throws once it has decided the rejection is
 * fatal to the request, so the REST boundary can serialise it.
 *
 * Both codes clear the handled-error bar of ADR-045: we know the cause (the
 * query is malformed, or it names something the policy withholds) and the
 * caller can act on it (rewrite the query). Neither message names an internal
 * table, a server setting, a host, a database identity, or another tenant —
 * `message` rides in the REST response body, so that is a rule, not a habit.
 *
 * @see dev/docs/best_practices/error-handling.md
 * @see dev/docs/adr/045-domain-errors-handled-boundary.md
 */
import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";
import type { RejectedGovernedSql } from "./validate";
import type { GovernedSqlViolation } from "./violations";

/**
 * `meta` for both codes: the violations, verbatim.
 *
 * Named consumer, as the contract requires — this API's client is usually an
 * agent writing SQL with no UI at all, and the violation list is the only thing
 * that tells it *which* of five joins to change. Nothing else goes in here; the
 * SQL, the resolved policy and the trace ids belong in the log line.
 */
function violationMeta(
  violations: readonly GovernedSqlViolation[],
): Record<string, unknown> {
  return { violations };
}

/** The submitted text is not valid ClickHouse SQL. */
export class GovernedSqlUnparseableError extends HandledError {
  declare readonly code: "governed_sql_unparseable";

  constructor(
    violations: readonly GovernedSqlViolation[],
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "governed_sql_unparseable",
      "The submitted SQL could not be parsed.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: violationMeta(violations),
        ...remediation("governed_sql_unparseable"),
        ...options,
      },
    );
    this.name = "GovernedSqlUnparseableError";
  }
}

/** The query parses, but the governed-SQL policy refuses it. */
export class GovernedSqlNotPermittedError extends HandledError {
  declare readonly code: "governed_sql_not_permitted";

  constructor(
    violations: readonly GovernedSqlViolation[],
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "governed_sql_not_permitted",
      "The submitted SQL is not permitted by the governed analytics policy.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: violationMeta(violations),
        ...remediation("governed_sql_not_permitted"),
        ...options,
      },
    );
    this.name = "GovernedSqlNotPermittedError";
  }
}

/**
 * Turns a rejection into the handled error for it.
 *
 * A rejection whose only reason is that the text would not parse is a different
 * failure from one where the policy refused a construct: the first is a typo,
 * the second is a query doing something this API does not do, and telling a
 * caller to "check the syntax" of syntactically perfect SQL sends them looking
 * in the wrong place.
 */
export function governedSqlValidationError(
  rejection: RejectedGovernedSql,
): HandledError {
  const unparseable = rejection.violations.every(
    (violation) => violation.code === "PARSE_FAILED",
  );
  return unparseable
    ? new GovernedSqlUnparseableError(rejection.violations)
    : new GovernedSqlNotPermittedError(rejection.violations);
}
