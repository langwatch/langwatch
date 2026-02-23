import type { Logger } from "pino";

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
 * Checks both `status` (HttpError, Hono) and `httpStatus` (DomainError).
 */
export function getStatusCodeFromError(error: unknown): number {
  if (error instanceof Error) {
    if ("httpStatus" in error && typeof error.httpStatus === "number") {
      return error.httpStatus;
    }
    if ("status" in error && typeof error.status === "number") {
      return error.status;
    }
  }

  if (error) {
    return 500;
  }

  return 200;
}

/**
 * Determines log level based on HTTP status code.
 * - 4xx: 'warn' (client errors - expected, handled)
 * - 5xx: 'error' (server errors - unexpected, needs attention)
 * - Others: 'info' (success or redirects)
 */
export function getLogLevelFromStatusCode(
  statusCode: number,
): "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return "info";
}

/**
 * Logs an HTTP request with appropriate level based on status code.
 * Uses error level for 5xx, warn for 4xx, info for success.
 */
export function logHttpRequest(logger: Logger, data: RequestLogData): void {
  const logData: Record<string, unknown> = {
    method: data.method,
    url: data.url,
    statusCode: data.statusCode,
    duration: data.duration,
    userAgent: data.userAgent,
    ...data.extra,
  };

  if (data.error) {
    logData.error = data.error;
  }

  const level = getLogLevelFromStatusCode(data.statusCode);
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

  return !!(
    xAuthToken ??
    (authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7)
      : null)
  );
}
