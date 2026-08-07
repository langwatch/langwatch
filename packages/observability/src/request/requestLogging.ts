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
 * Where a cause is attached on a record that is NOT at error level.
 *
 * Loki derives `detected_level` from the presence of a field named `error` and
 * that guess beats the `severity_text` we actually emitted. So a handled 402,
 * logged at warn exactly as intended, arrived in Loki as an error — 128k a day
 * of them on one service, swamping the genuine 5xx and making every dashboard
 * and alert built on `detected_level` read the opposite of the truth.
 *
 * Same rule, and same reason, as `VENDOR_CAUSE_FIELD` in
 * `@langwatch/clickhouse-client`.
 */
export const REQUEST_CAUSE_FIELD = "requestError";

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

  const level = getLogLevelForRequest(data.error, data.statusCode);

  if (data.error) {
    // At error level the field keeps its name: `detected_level` and
    // `severity_text` already agree there, and every 5xx dashboard slices on
    // the `error_*` metadata the serializer derives from it. Only the levels
    // where the two disagree are re-keyed.
    if (level === "error") {
      logData.error = data.error;
    } else {
      logData[REQUEST_CAUSE_FIELD] = data.error;
      // Re-keying costs the derived `error_type`, which is how these records
      // were grouped. Restated flat so the grouping survives the move.
      const name = (data.error as { name?: unknown }).name;
      if (typeof name === "string") logData.errorType = name;
    }

    const fault = handledFaultOf(data.error);
    if (fault) {
      logData.handledErrorCode = (data.error as Record<string, unknown>).code;
      logData.handledErrorFault = fault;
    }
  }

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
