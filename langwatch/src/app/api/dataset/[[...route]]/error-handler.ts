import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createLogger } from "../../../../utils/logger";
import { errorSchema } from "../../shared/schemas";
import { HttpError, InternalServerError } from "../../shared/errors";

const logger = createLogger("langwatch:api:dataset:errors");

/**
 * Error handler for dataset API routes.
 * Converts thrown errors to proper error responses matching the errorSchema.
 */
export const handleDatasetError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const path = c.req.path;
  const method = c.req.method;
  const routeParams = c.req.param();
  const status =
    error instanceof HttpError ? error.status : error.status ?? 500;

  // Log the error with context (including status code)
  logger.error(
    {
      path,
      method,
      routeParams,
      status,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    `Dataset API Error [${status}]: ${error.message || String(error)}`,
  );

  // Handle HttpError instances (our typed errors)
  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }

  // Default to 500 for unexpected errors
  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
