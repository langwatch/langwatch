import type { Logger } from "../logger";

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
 * Determines log level based on HTTP status code.
 * - 404: 'info' (not found is a normal response, not a warning)
 * - 4xx: 'warn' (client errors - expected, handled)
 * - 5xx: 'error' (server errors - unexpected, needs attention)
 * - Others: 'info' (success or redirects)
 */
export function getLogLevelFromStatusCode(
  statusCode: number,
): "info" | "warn" | "error" {
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
export function handledFaultOf(
  error: unknown,
): "customer" | "platform" | "provider" | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  if (typeof e.code !== "string" || typeof e.httpStatus !== "number") {
    return undefined;
  }
  const fault = e.fault;
  return fault === "customer" || fault === "platform" || fault === "provider"
    ? fault
    : undefined;
}

/**
 * Request log level, fault-aware: a handled error logs by fault attribution —
 * `customer` → warn (expected; spike-watched), `platform`/`provider` → error
 * (incident). Unhandled errors stay status-based. This is the same rule the
 * tRPC logger applies, so all boundaries agree.
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
 * Logs an HTTP request with appropriate level based on status code.
 * Uses error level for 5xx, warn for 4xx, info for success.
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

  if (data.error) {
    logData.error = data.error;
    const fault = handledFaultOf(data.error);
    if (fault) {
      logData.handledErrorCode = (data.error as Record<string, unknown>).code;
      logData.handledErrorFault = fault;
    }
  }

  const level = getLogLevelForRequest(data.error, data.statusCode);
  const message = data.error ? "error handling request" : "request handled";

  logger[level](logData, message);
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
