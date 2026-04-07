import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createLogger } from "../../../../utils/logger/server";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:agents:errors");

/**
 * Error handler for agent API routes.
 * Converts thrown errors to proper error responses matching the errorSchema.
 */
export const handleAgentError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const path = c.req.path;
  const method = c.req.method;
  const routeParams = c.req.param();
  const status =
    error instanceof HttpError ? error.status : (error.status ?? 500);

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
    `Agent API Error [${status}]: ${error.message || String(error)}`,
  );

  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
