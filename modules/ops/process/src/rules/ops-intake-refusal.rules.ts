import { HandledError } from "@langwatch/handled-error";

/** One refusal as a public ops door writes it: the status and the JSON body. */
export type OpsDoorRefusal = { status: number; body: Record<string, unknown> };

/** Main's unhandled body; its trace block needs the refusal to carry the trace id. */
const UNHANDLED = { error: "Internal server error", message: "An unknown error occurred" };

/**
 * A bug-report refusal in the bodies released builds read: a body that does not
 * parse, a report that fails its schema (zod's flattened `details`), or a named one.
 */
export function bugReportRefusal(failure: Error): OpsDoorRefusal {
  if (!HandledError.isHandled(failure)) return { status: 500, body: UNHANDLED };

  const status = (failure.httpStatus ?? 500) >= 400 ? (failure.httpStatus ?? 500) : 500;
  if (failure.code === "malformed_request") {
    return { status, body: { error: "Invalid body, expecting JSON" } };
  }
  if (failure.code !== "validation_error") {
    return { status, body: { error: failure.message, code: failure.code } };
  }

  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const reason of failure.reasons) {
    const target = reasonTarget(reason);
    if (target.kind === "root") {
      formErrors.push(reason.message);
      continue;
    }
    const key = target.path.split(".")[0] ?? target.path;
    fieldErrors[key] = [...(fieldErrors[key] ?? []), reason.message];
  }

  return { status, body: { error: "Invalid report", details: { formErrors, fieldErrors } } };
}

/** The name the EXPLAIN route's bearer door refuses under. */
export const OPS_OPERATOR_DOOR = "ops-operator";

/**
 * An operator EXPLAIN refusal in the `{ message }` the operator tool parses:
 * the first failing field prefixes its message, as main's `path: message` did.
 * Every refusal of the door, an unset or blank secret's included, is main's 401.
 */
export function operatorExplainRefusal(failure: Error): OpsDoorRefusal {
  if (!HandledError.isHandled(failure)) return { status: 500, body: UNHANDLED };
  if (failure.meta.surface === OPS_OPERATOR_DOOR) {
    return { status: 401, body: { message: "Unauthorized" } };
  }

  const status = (failure.httpStatus ?? 500) >= 400 ? (failure.httpStatus ?? 500) : 500;
  if (failure.code === "malformed_request") {
    return { status, body: { message: "request body must be JSON" } };
  }
  if (failure.code !== "validation_error") return { status, body: { message: failure.message } };

  const first = failure.reasons[0];
  if (!first) return { status, body: { message: "invalid body" } };
  const target = reasonTarget(first);

  return {
    status,
    body: { message: target.kind === "field" ? `${target.path}: ${first.message}` : first.message },
  };
}

type ReasonTarget = { kind: "field"; path: string } | { kind: "root" };

/** Whether a schema reason names a dotted field or the document root. */
function reasonTarget(reason: Error): ReasonTarget {
  const field = HandledError.isHandled(reason) ? reason.meta.field : void 0;

  return typeof field === "string" && field !== "(root)"
    ? { kind: "field", path: field }
    : { kind: "root" };
}
