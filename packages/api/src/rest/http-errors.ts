import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The status-carrying error vocabulary the REST boundary throws, kept
 * beside the secured-app builder so a packaged and an application-mounted
 * family throw the same failures for the same `onError`. No `code`, fault
 * or remediation: the flat legacy envelope pre-`HandledError` families
 * publish. Reach for `HandledError` when the cause is known and actionable.
 */
export abstract class HttpError extends Error {
  abstract readonly status: ContentfulStatusCode;
  error: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    this.error = message;
  }
}

/**
 * Error for 400 Bad Request responses
 */
export class BadRequestError extends HttpError {
  readonly status = 400;
  constructor(message = "Bad request") {
    super(message);
  }
}

/**
 * Error for 401 Unauthorized responses
 */
export class UnauthorizedError extends HttpError {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
  }
}

/**
 * Error for 403 Forbidden responses.
 *
 * The caller is authenticated and holds the permission; the request is
 * refused on its own merits. Use `UnauthorizedError` when the credentials or
 * the permission are what is missing.
 */
export class ForbiddenError extends HttpError {
  readonly status = 403;
  constructor(message = "Forbidden") {
    super(message);
  }
}

/**
 * Error for 404 Not Found responses
 */
export class NotFoundError extends HttpError {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
  }
}

/**
 * Error for 422 Unprocessable Entity responses
 */
export class UnprocessableEntityError extends HttpError {
  readonly status = 422;
  constructor(message = "Unprocessable entity") {
    super(message);
  }
}

/**
 * Error for 500 Internal Server Error responses
 */
export class InternalServerError extends HttpError {
  readonly status = 500;
  constructor(message = "Internal server error") {
    super(message);
  }
}

/**
 * Hono's own `HTTPException`, recognised by shape rather than
 * `instanceof`, which answers false whenever the two ends resolved
 * `hono/http-exception` to different module instances — losing the
 * refusal's status and reaching the caller as a generic 500.
 */
export function isFrameworkRefusal(
  error: unknown,
): error is Error & { status: ContentfulStatusCode; getResponse: () => Response } {
  if (!(error instanceof Error)) return false;
  const candidate = error as { status?: unknown; getResponse?: unknown };
  return typeof candidate.status === "number" && typeof candidate.getResponse === "function";
}
