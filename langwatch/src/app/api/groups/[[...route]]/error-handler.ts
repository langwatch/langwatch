import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createLogger } from "../../../../utils/logger/server";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:groups:errors");

export const handleGroupError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const status =
    error instanceof HttpError ? error.status : (error.status ?? 500);

  logger.error(
    {
      path: c.req.path,
      method: c.req.method,
      routeParams: c.req.param(),
      status,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    `Groups API Error [${status}]: ${error.message || String(error)}`,
  );

  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
