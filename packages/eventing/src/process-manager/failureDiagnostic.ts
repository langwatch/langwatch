import { HandledError } from "@langwatch/handled-error";

const GENERIC_FAILURE_MESSAGE = "Operation failed; sensitive details were omitted";

/** The field that says we wrote an error's message; a plain field survives a lost prototype. */
export const DIAGNOSTIC_SAFE = "diagnosticSafe";

/**
 * Stamp an error we authored (a fixed sentence plus ids we already log) as safe to quote.
 * Never wrap a third-party error with it: a Prisma, ClickHouse or SDK message can carry
 * parameters, row values or response bodies, which is what the generic message is for.
 */
export function markDiagnosticSafe<E extends Error>(error: E): E {
  Reflect.set(error, DIAGNOSTIC_SAFE, true);
  return error;
}

/** An error that names its own cause in a message we wrote. */
export function safeDiagnosticError(message: string): Error {
  return markDiagnosticSafe(new Error(message));
}

/** Ours: stamped by {@link markDiagnosticSafe}, a `DispatchError` (ADR-027) or a `HandledError`. */
function messageIsOurs(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (Reflect.get(error, DIAGNOSTIC_SAFE) === true) return true;
  if (error.name === "DispatchError" && typeof Reflect.get(error, "retryable") === "boolean") {
    return true;
  }
  return HandledError.isHandled(error);
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
 * A bounded diagnostic safe for logs and exported telemetry. A foreign message can copy
 * customer content or credentials, so it becomes a fixed sentence; one we wrote is quoted,
 * since redacting our own words leaves the operator reading "Operation failed" on every attempt.
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
