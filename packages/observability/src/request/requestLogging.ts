import { REQUEST_CAUSE_FIELD } from "../constants.ts";
import type { Logger } from "../logger.ts";

/**
 * Common request logging data structure.
 */
export interface RequestLogData {
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  userAgent: string | null;
  error?: unknown;
  /** Additional context to include in log */
  extra?: Record<string, unknown>;
}

/**
 * Extracts HTTP status code from an error object.
 * Returns 500 for generic errors, 200 if no error.
 * Checks both `status` (HttpError, Hono) and `httpStatus` (HandledError).
 */
export function getStatusCodeFromError(error: unknown): number {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.httpStatus === "number") return err.httpStatus;
    if (typeof err.status === "number") return err.status;
    return 500;
  }

  if (error) {
    return 500;
  }

  return 200;
}

/**
 * Log level by HTTP status: 404 is `info` (a normal response, not a
 * warning), other 4xx are `warn`, 5xx `error`, everything else `info`.
 */
export function getLogLevelFromStatusCode(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode === 404) return "info";
  if (statusCode >= 400) return "warn";
  return "info";
}

/**
 * The fault attribution of a handled error, duck-typed (`code` + `httpStatus`
 * + `fault`) so this package doesn't import the HandledError class. Returns
 * undefined for unhandled errors.
 */
export function handledFaultOf(error: unknown): "customer" | "platform" | "provider" | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.code !== "string" || typeof e.httpStatus !== "number") {
    return undefined;
  }
  const fault = e.fault;
  return fault === "customer" || fault === "platform" || fault === "provider" ? fault : undefined;
}

/**
 * Request log level, fault-aware: a handled error logs by fault —
 * `customer` warns (expected, spike-watched), `platform`/`provider` errors
 * (incident); unhandled stays status-based. Same rule the tRPC logger applies.
 */
export function getLogLevelForRequest(
  error: unknown,
  statusCode: number,
): "info" | "warn" | "error" {
  const fault = handledFaultOf(error);
  if (fault === "customer") return "warn";
  if (fault === "platform" || fault === "provider") return "error";
  return getLogLevelFromStatusCode(statusCode);
}

/**
 * The `errorType` given to a 5xx that arrived with nothing attached, so the
 * records group and count like any other failure shape rather than hiding
 * among the successes.
 */
const UNCAUSED_SERVER_ERROR = "UncausedServerError";

/**
 * Attaches the cause under the field its level allows: error-level uses "error",
 * others use {@link REQUEST_CAUSE_FIELD}.
 */
function attachCause({
  logData,
  error,
  level,
}: {
  logData: Record<string, unknown>;
  error: unknown;
  level: "info" | "warn" | "error";
}): void {
  if (level === "error") {
    logData.error = error;
  } else {
    logData[REQUEST_CAUSE_FIELD] = error;
    // Re-keying costs the derived `error_type`, which is how these records
    // were grouped. Restated flat so the grouping survives the move.
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") logData.errorType = name;
  }

  const fault = handledFaultOf(error);
  if (fault) {
    logData.handledErrorCode = (error as Record<string, unknown>).code;
    logData.handledErrorFault = fault;
  }
}

/**
 * What the record says happened. A 5xx with no cause attached must not claim
 * the request was handled: that message is the only thing distinguishing it
 * from a success in every log view that does not print the status.
 */
function requestLogMessage({
  error,
  level,
}: {
  error: unknown;
  level: "info" | "warn" | "error";
}): string {
  if (error) return "error handling request";
  return level === "error" ? "request failed without a cause attached" : "request handled";
}

/**
 * Logs an HTTP request with appropriate level based on status code (5xx=error,
 * 4xx=warn, success=info).
 */
export function logHttpRequest(logger: Logger, data: RequestLogData): void {
  const logData: Record<string, unknown> = {
    ...data.extra,
    method: data.method,
    url: data.url,
    statusCode: data.statusCode,
    duration: data.duration,
    userAgent: data.userAgent,
  };

  const level = getLogLevelForRequest(data.error, data.statusCode);

  if (data.error) {
    attachCause({ logData, error: data.error, level });
  } else if (level === "error") {
    // Route returned 5xx without throwing: name it so it can be found and traced.
    logData.errorType = UNCAUSED_SERVER_ERROR;
  }

  logger[level](logData, requestLogMessage({ error: data.error, level }));
}

/**
 * Detects if an authorization token is present in request headers.
 */
export function hasAuthorizationToken(headers: {
  "x-auth-token"?: string;
  authorization?: string;
}): boolean {
  const xAuthToken = headers["x-auth-token"];
  const authHeader = headers.authorization;

  if (xAuthToken) return true;
  if (authHeader) return true;

  return false;
}
