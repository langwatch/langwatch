/**
 * Both codes clear the handled-error bar of ADR-045: we know the cause (the
 * @see dev/docs/best_practices/error-handling.md
 * @see dev/docs/adr/045-domain-errors-handled-boundary.md
 */
import { HandledError, remediation } from "@langwatch/handled-error";

import type { LangWatchQLViolation } from "./langwatch-ql-violation.ts";

/**
 * `meta` for both codes: the violations, verbatim. Named consumer, as the contract requires —
 * this API's client is usually an agent writing SQL with no UI at all, and the violation list
 * is the only thing that tells it *which* of five joins to change.
 */
function violationMeta(violations: readonly LangWatchQLViolation[]): Record<string, unknown> {
  return { violations };
}

/** The submitted text is not valid ClickHouse SQL. */
export class LangWatchQLUnparseableError extends HandledError {
  declare readonly code: "lwql_unparseable";

  constructor(
    violations: readonly LangWatchQLViolation[],
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("lwql_unparseable", "The submitted SQL could not be parsed.", {
      httpStatus: 400,
      fault: "customer",
      meta: violationMeta(violations),
      ...remediation("lwql_unparseable"),
      ...options,
    });
    this.name = "LangWatchQLUnparseableError";
  }
}

/** The query parses, but the LangWatchQL policy refuses it. */
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
