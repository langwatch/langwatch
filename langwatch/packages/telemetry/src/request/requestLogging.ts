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

  if (xAuthToken) return true;
  if (authHeader) return true;

  return false;
}
