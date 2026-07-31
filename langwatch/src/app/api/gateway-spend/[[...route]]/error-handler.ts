import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handleError } from "../../middleware/error-handler";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:gateway-spend:errors");

export const handleGatewaySpendApiError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  const status =
    error instanceof HttpError ? error.status : (error.status ?? 500);
  logger.error(
    {
      path: c.req.path,
      method: c.req.method,
      status,
      error: { name: error.name, message: error.message, stack: error.stack },
    },
    `Gateway spend API Error [${status}]: ${error.message || String(error)}`,
  );

  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }
  if (HandledError.isHandled(error)) return handleError(error, c);

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
