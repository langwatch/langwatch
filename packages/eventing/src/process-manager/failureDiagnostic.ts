const GENERIC_FAILURE_MESSAGE = "Operation failed; sensitive details were omitted";

/**
 * Returns a bounded diagnostic that is safe for logs and exported telemetry.
 * Error messages and custom names are untrusted because process inputs and
 * provider failures can copy customer content or credentials into either.
 */
export function toSafeFailureDiagnostic(error: unknown): {
  errorType: string;
  errorMessage: string;
} {
  let errorType = "NonErrorThrown";

  if (error instanceof AggregateError) {
    errorType = "AggregateError";
  } else if (error instanceof TypeError) {
    errorType = "TypeError";
  } else if (error instanceof RangeError) {
    errorType = "RangeError";
  } else if (error instanceof ReferenceError) {
    errorType = "ReferenceError";
  } else if (error instanceof SyntaxError) {
    errorType = "SyntaxError";
  } else if (error instanceof URIError) {
    errorType = "URIError";
  } else if (error instanceof EvalError) {
    errorType = "EvalError";
  } else if (error instanceof Error) {
    errorType = "Error";
  }

  return { errorType, errorMessage: GENERIC_FAILURE_MESSAGE };
}

/** A stored process state its schema no longer reads; carries issue paths, never values. */
export class ProcessStateUnreadableError extends Error {
  override readonly name = "ProcessStateUnreadableError";
  readonly processName: string;
  readonly processKey: string;
  readonly issuePaths: readonly string[];

  constructor(params: { processName: string; processKey: string; issuePaths: readonly string[] }) {
    super(`Stored state of process "${params.processName}" does not match its state schema`);
    this.processName = params.processName;
    this.processKey = params.processKey;
    this.issuePaths = params.issuePaths;
  }
}
