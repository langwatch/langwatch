const GENERIC_FAILURE_MESSAGE =
  "Operation failed; sensitive details were omitted";

/**
 * The marker an error carries to say its message was authored by us and holds
 * no foreign content. Checked as a plain field rather than by `instanceof`,
 * for the same reason `DispatchError` is checked by name: the error may have
 * crossed a worker or serialisation boundary that stripped its prototype.
 */
export const DIAGNOSTIC_SAFE = "diagnosticSafe";

/**
 * Stamp an error we authored as safe to quote back to ourselves.
 *
 * Use it for internal failures whose message is a fixed sentence plus ids we
 * already log — a lost compare-and-swap, a guard that refused, an invariant
 * that did not hold. Do NOT use it to wrap a third-party error: a Prisma,
 * ClickHouse or provider-SDK message can carry query parameters, row values
 * or response bodies, which is exactly what the generic message exists for.
 */
export function markDiagnosticSafe<E extends Error>(error: E): E {
  Reflect.set(error, DIAGNOSTIC_SAFE, true);
  return error;
}

/** An error that names its own cause in a message we wrote. */
export function safeDiagnosticError(message: string): Error {
  return markDiagnosticSafe(new Error(message));
}

/**
 * Whether this error's own message may be quoted.
 *
 * Three provenances qualify, and all three are about who wrote the words:
 *
 * - a `HandledError`, whose `message` is customer-safe by contract
 *   (`dev/docs/best_practices/error-handling.md`);
 * - a `DispatchError`, the delivery diagnostic our dispatch endpoints
 *   assemble on purpose (ADR-027);
 * - anything stamped by {@link markDiagnosticSafe}.
 *
 * Everything else is foreign until proven otherwise.
 */
function messageIsOurs(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (Reflect.get(error, DIAGNOSTIC_SAFE) === true) return true;
  if (
    error.name === "DispatchError" &&
    typeof Reflect.get(error, "retryable") === "boolean"
  ) {
    return true;
  }
  return typeof Reflect.get(error, "code") === "string" && isHandledError(error);
}

/** `HandledError` stamps `handled` in its constructor; the field survives a
 *  serialisation boundary that the prototype does not. */
function isHandledError(error: Error): boolean {
  return Reflect.get(error, "handled") === true;
}

function builtinErrorType(error: unknown): string {
  if (error instanceof AggregateError) return "AggregateError";
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof URIError) return "URIError";
  if (error instanceof EvalError) return "EvalError";
  if (error instanceof Error) return "Error";
  return "NonErrorThrown";
}

/**
 * Returns a bounded diagnostic that is safe for logs and exported telemetry.
 *
 * A third-party error's message is untrusted, because process inputs and
 * provider failures can copy customer content or credentials into it, so it
 * is replaced by a fixed sentence. An error WE authored is a different thing
 * entirely: redacting it hides our own words from us and leaves an operator
 * reading "Operation failed" eleven times over with no way to recover the
 * cause — the failure this function is supposed to be describing becomes
 * invisible in the logs, the span and the attempt log at once.
 *
 * So the rule is provenance, not audience: {@link messageIsOurs} decides, and
 * every surface gets the same answer.
 */
export function toSafeFailureDiagnostic(error: unknown): {
  errorType: string;
  errorMessage: string;
} {
  if (messageIsOurs(error)) {
    return { errorType: error.name, errorMessage: error.message };
  }
  return {
    errorType: builtinErrorType(error),
    errorMessage: GENERIC_FAILURE_MESSAGE,
  };
}
