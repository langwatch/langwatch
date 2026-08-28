import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { handleError } from "../../middleware/error-handler";
import { HttpError, InternalServerError } from "../../shared/errors";
import { errorSchema } from "@langwatch/platform-api/app-rest";

const logger = createLogger("langwatch:api:groups:errors");

export const handleGroupError = async (
  error: Error & { status?: ContentfulStatusCode },
  c: Context,
): Promise<Response> => {
  // A handled error's status lives on `httpStatus`; without reading it, a
  // 402 plan refusal would be logged as a 500 while the response says 402.
  // Same order as the response dispatch below, and as the api-keys handler.
  const status =
    error instanceof HttpError
      ? error.status
      : HandledError.isHandled(error)
        ? (error.httpStatus as ContentfulStatusCode)
        : (error.status ?? 500);

  // A refusal the caller can act on is their fact, not our outage: the
  // Enterprise gate answers 402 from every route in this family, and logging
  // all of them at error level buries the real failures under routine ones.
  const log = status >= 500 ? logger.error : logger.warn;
  log.call(
    logger,
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

  // A handled error already knows its own status, code, meta, reasons and
  // remediation — collapsing it to a 500 here would throw all of that away and
  // report the caller's mistake as our outage. This handler exists to add the
  // family's domain mapping on top of the shared boundary, not to replace it,
  // so anything it has not specifically claimed goes to `handleError`.
  if (HandledError.isHandled(error)) return handleError(error, c);

  const internalError = new InternalServerError();
  return c.json(errorSchema.parse(internalError), internalError.status);
};
