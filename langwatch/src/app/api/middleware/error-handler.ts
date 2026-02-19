import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { DomainError } from "~/server/app-layer/domain-error";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors";

import { HttpError, NotFoundError } from "../shared/errors";
import { errorSchema } from "../shared/schemas";

/**
 * Error handling middleware that catches errors and formats responses.
 * Should be used with the `onError` callback of the Hono app.
 * @see https://hono.dev/docs/api/hono#error-handling
 *
 * @example
 * ```ts
 * app.onError(handleError);
 * ```
 */
export const handleError = async (
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
  c: Context,
) => {
  // Determine status code and response
  // Note: Logging is handled by the logger middleware, not here, to avoid double logging
  const { statusCode, response } = determineErrorResponse(error);

  return c.json(response, statusCode);
};

function determineErrorResponse(
  error: Error & {
    status?: ContentfulStatusCode;
    code?: string;
    name?: string;
  },
): { statusCode: ContentfulStatusCode; response: object } {
  // DomainErrors are handled first — they carry their own status and serialized shape
  if (DomainError.is(error)) {
    return {
      statusCode: error.httpStatus as ContentfulStatusCode,
      response: error.serialize(),
    };
  }

  // Check if it's a "not found" error
  const isNotFoundError =
    error.message?.includes("not found") ||
    // Prisma error code for "not found"
    error.code === "P2025" ||
    error instanceof NotFoundError ||
    error.name === "NotFoundError";

  if (isNotFoundError) {
    const notFoundError = new NotFoundError(error.message);
    return {
      statusCode: notFoundError.status,
      response: errorSchema.parse(notFoundError),
    };
  }

  // Handle HttpError instances (can be parsed directly)
  if (error instanceof HttpError) {
    return {
      statusCode: error.status,
      response: errorSchema.parse(error),
    };
  }

  if (error.status) {
    return {
      statusCode: error.status,
      response: errorSchema.parse({
        error: error.message || "An error occurred",
        message: error.message,
      }),
    };
  }

  // Otherwise treat as server error
  return {
    statusCode: 500,
    response: errorSchema.parse({
      error: "Internal server error",
      message:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Internal server error",
    }),
  };
}
