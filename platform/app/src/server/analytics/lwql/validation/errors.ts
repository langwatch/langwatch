/**
 * LangWatchQL analytics SQL — how a refusal crosses the API boundary.
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
import type { RejectedLangWatchQL } from "./validate";
import type { LangWatchQLViolation } from "./violations";

/**
 * `meta` for both codes: the violations, verbatim.
 *
 * Named consumer, as the contract requires — this API's client is usually an
 * agent writing SQL with no UI at all, and the violation list is the only thing
 * that tells it *which* of five joins to change. Nothing else goes in here; the
 * SQL, the resolved policy and the trace ids belong in the log line.
 */
function violationMeta(
  violations: readonly LangWatchQLViolation[],
): Record<string, unknown> {
  return { violations };
}

/** The submitted text is not valid ClickHouse SQL. */
export class LangWatchQLUnparseableError extends HandledError {
  declare readonly code: "lwql_unparseable";

  constructor(
    violations: readonly LangWatchQLViolation[],
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "lwql_unparseable",
      "The submitted SQL could not be parsed.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: violationMeta(violations),
        ...remediation("lwql_unparseable"),
        ...options,
      },
    );
    this.name = "LangWatchQLUnparseableError";
  }
}

/** The query parses, but the lwql-SQL policy refuses it. */
export class LangWatchQLNotPermittedError extends HandledError {
  declare readonly code: "lwql_not_permitted";

  constructor(
    violations: readonly LangWatchQLViolation[],
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "lwql_not_permitted",
      "The submitted SQL is not permitted by the LangWatchQL analytics policy.",
      {
        httpStatus: 400,
        fault: "customer",
        meta: violationMeta(violations),
        ...remediation("lwql_not_permitted"),
        ...options,
      },
    );
    this.name = "LangWatchQLNotPermittedError";
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
export function lwqlValidationError(
  rejection: RejectedLangWatchQL,
): HandledError {
  const unparseable = rejection.violations.every(
    (violation) => violation.code === "PARSE_FAILED",
  );
  return unparseable
    ? new LangWatchQLUnparseableError(rejection.violations)
    : new LangWatchQLNotPermittedError(rejection.violations);
}
