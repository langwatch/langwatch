import { REQUEST_CAUSE_FIELD } from "../constants";
import type { Logger } from "../logger";
import type { RequestAttribution } from "./trafficAttribution";

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
  /**
   * Traffic attribution (endpoint class + client source), flattened onto the
   * log line. These fields plus the tenant the logging context stamps are
   * what the usage dashboards slice by.
   */
  attribution?: RequestAttribution;
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
 * The `errorType` given to a 5xx that arrived with nothing attached, so the
 * records group and count like any other failure shape rather than hiding
 * among the successes.
 */
const UNCAUSED_SERVER_ERROR = "UncausedServerError";

/**
 * Attaches the cause under the field its level allows, plus the handled
 * attribution when the error carries one.
 *
 * At error level the field keeps its name — the record IS a failure, and every
 * 5xx dashboard slices on the `error_*` metadata the serializer derives from
 * it. Only the levels where that name would misrepresent the record are
 * re-keyed.
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
  return level === "error"
    ? "request failed without a cause attached"
    : "request handled";
}

/**
 * The convention {@link REQUEST_CAUSE_FIELD} belongs to matches
 * `VENDOR_CAUSE_FIELD` and `RETRY_CAUSE_FIELD` in
 * `@langwatch/clickhouse-client`, so all three agree.
 *
 * What it does NOT fix, despite what those two modules claim: prod Loki's
 * `detected_level`. Measured 2026-08-07 — Loki 3.3 reads the level by parsing
 * the LOG LINE as JSON, and our lines are not JSON. fluent-bit promotes these
 * fields to structured metadata and ships the bare message as the line, so Loki
 * never sees this field at all and falls back to scanning the message text for
 * "error" / "warn". `"error handling request"` contains the word, which is what
 * promoted 129k handled 402s a day. Renaming a field the parser cannot reach
 * changes nothing there; the fix is `discover_log_levels: false` on the Loki
 * side, and `severity_text` as the only level anything queries.
 *
 * Logs an HTTP request with appropriate level based on status code.
 * Uses error level for 5xx, warn for 4xx, info for success.
 */
export function logHttpRequest(logger: Logger, data: RequestLogData): void {
  const logData: Record<string, unknown> = {
    ...data.extra,
    ...data.attribution,
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
    // A route can answer 5xx by RETURNING the response rather than throwing, so
    // nothing reaches the middleware to attach. The status still forces error
    // level, and the record then read `request handled` with no cause on it —
    // indistinguishable from a success unless you happened to read statusCode.
    //
    // Production logged 12,367 of these in a single hour on 2026-08-13, every
    // one a 500, and between them they said nothing about what had failed.
    // Naming the shape is the whole fix: it cannot be diagnosed from here, but
    // it can be found, counted, and traced back to a route.
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
