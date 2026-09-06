import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The status-carrying error vocabulary the REST boundary throws.
 *
 * It lives beside the secured-app builder rather than inside the application
 * because a REST family packaged here throws the same failures a family still
 * mounted from the application does, and both are rendered by the same
 * `onError`. Two definitions would let one surface's 422 become the other's
 * 500 without anything reporting it.
 *
 * These carry no `code`, no fault attribution and no remediation: they are the
 * flat legacy envelope (`{ error, message }`) the families that predate
 * `HandledError` publish, and their consumers parse. Reach for a
 * `HandledError` when the cause is known and the caller can act on it.
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
 * Hono's own `HTTPException`, recognised by shape rather than by `instanceof`.
 *
 * A framework refusal crosses a package boundary on the way from the family
 * that raised it to the process handler that renders it, and `instanceof`
 * answers false whenever the two ends resolved `hono/http-exception` to
 * different module instances — the ESM and CommonJS builds of one version, or
 * a copy the loader wrapped. The refusal then loses its status and reaches the
 * caller as a generic 500, which is the failure this predicate exists to
 * prevent. The two members below are the whole public shape of the class.
 */
export function isFrameworkRefusal(
  error: unknown,
): error is Error & { status: ContentfulStatusCode; getResponse: () => Response } {
  if (!(error instanceof Error)) return false;
  const candidate = error as { status?: unknown; getResponse?: unknown };
  return typeof candidate.status === "number" && typeof candidate.getResponse === "function";
}
