import { createLogger } from "@langwatch/observability";
import { HandledError } from "@langwatch/handled-error";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "../../shared/schemas";
import { handleError } from "../../middleware/error-handler";

const logger = createLogger("langwatch:api:api-keys:errors");

export const handleApiKeyError = async (
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
    `API Keys Error [${status}]: ${error.message || String(error)}`,
  );

  if (error instanceof HttpError) {
    return c.json(errorSchema.parse(error), error.status);
  }

  // A handled error already knows its own status, code, meta, reasons and
  // remediation — collapsing it to a 500 here would throw all of that away and
  // report the caller's mistake as our outage. This handler exists to add the
  // family's domain mapping on top of the shared boundary, not to replace it,
  // so anything it has not specifically claimed goes to `handleError`.
  if (HandledError.isHandled(error)) return handleError(error, c);

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
