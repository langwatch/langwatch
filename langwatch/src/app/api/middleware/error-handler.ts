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
  // DomainErrors are handled first — normalize to client-safe shape.
  // Use kind + httpStatus check instead of instanceof to handle
  // module-boundary class identity mismatches in Next.js/turbopack.
  // See domain-error.ts: "use kind instead of instanceof in cross-process cases"
  if (DomainError.is(error) || ("kind" in error && "httpStatus" in error)) {
    const { kind, message, httpStatus, meta } = error as DomainError;
    return {
      statusCode: (httpStatus ?? 500) as ContentfulStatusCode,
      response: {
        ...errorSchema.parse({ error: kind, message }),
        ...(meta ?? {}),
      },
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

  // Prisma unique-constraint violation — treat as 409 conflict with a
  // descriptive message. Route-specific `handlePossibleConflictError` may
  // already translate this into an HTTPException, but this global safety
  // net catches cases where that wrapper isn't wired up yet.
  if (
    error.code === "P2002" ||
    (error as { meta?: { target?: unknown } }).meta?.target
  ) {
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(", ")
      : typeof target === "string"
        ? target
        : undefined;
    return {
      statusCode: 409,
      response: errorSchema.parse({
        error: "Conflict",
        message: targetStr
          ? `Unique constraint violated on ${targetStr}`
          : error.message || "Unique constraint violated",
      }),
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

  // Otherwise treat as server error. We always include the underlying
  // error message (and any `code`) in the `message` field — even in
  // production — so the CLI and code assistants have something concrete
  // to surface. The `error` kind stays generic on purpose so clients can
  // still recognize the category.
  const underlying = error.message ?? "";
  const codeSuffix = error.code ? ` (${error.code})` : "";
  const nameSuffix =
    error.name && error.name !== "Error" ? ` [${error.name}]` : "";
  const descriptive = (underlying + codeSuffix + nameSuffix).trim();
  return {
    statusCode: 500,
    response: errorSchema.parse({
      error: "Internal server error",
      message: descriptive || "Internal server error",
    }),
  };
}
