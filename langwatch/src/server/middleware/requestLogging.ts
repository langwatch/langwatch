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
 */
export function getStatusCodeFromError(error: unknown): number {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  if (error) {
    return 500;
  }

  return 200;
}

/**
 * Logs an HTTP request with appropriate level based on error status.
 * Uses error level for errors, info level for success.
 */
export function logHttpRequest(
  logger: Logger,
  data: RequestLogData,
): void {
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
    logger.error(logData, "error handling request");
  } else {
    logger.info(logData, "request handled");
  }
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
