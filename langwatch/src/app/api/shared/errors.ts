import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Base class for HTTP API errors with status codes.
 * All API errors should extend this class.
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
  constructor(message: string = "Bad request") {
    super(message);
  }
}

/**
 * Error for 401 Unauthorized responses
 */
export class UnauthorizedError extends HttpError {
  readonly status = 401;
  constructor(message: string = "Unauthorized") {
    super(message);
  }
}

/**
 * Error for 404 Not Found responses
 */
export class NotFoundError extends HttpError {
  readonly status = 404;
  constructor(message: string = "Not found") {
    super(message);
  }
}

/**
 * Error for 422 Unprocessable Entity responses
 */
export class UnprocessableEntityError extends HttpError {
  readonly status = 422;
  constructor(message: string = "Unprocessable entity") {
    super(message);
  }
}

/**
 * Error for 500 Internal Server Error responses
 */
export class InternalServerError extends HttpError {
  readonly status = 500;
  constructor(message: string = "Internal server error") {
    super(message);
  }
}


