import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HttpError, InternalServerError } from "./http-errors.js";
import { errorSchema } from "./schemas.js";

/**
 * A family's own `onError`: its domain mapping layered over the process's
 * boundary handler.
 *
 * Every family that installs one wants the same three things — log the status
 * the caller actually received, answer an {@link HttpError} from its own
 * fields, and hand anything it has not specifically claimed to the boundary so
 * a handled error keeps its code, meta, reasons and remediation. Only the
 * logger's name and the sentence it prefixes differ, so those are the
 * parameters and the rest is shared.
 *
 * `boundary` is the process's `legacyErrorHandler`, off the security spine:
 * installing an `onError` REPLACES the one the spine installed, so a family
 * that did not delegate would silently stop rendering handled errors.
 */
export function createFamilyErrorHandler(options: {
  /** e.g. `langwatch:api:api-keys:errors`. */
  loggerName: string;
  /** e.g. `API Keys Error`, the prefix on the logged sentence. */
  label: string;
  boundary: ErrorHandler;
}): ErrorHandler {
  const logger = createLogger(options.loggerName);

  return async (error, c) => {
    // Same order as the response dispatch below, so the logged status is
    // always the status the caller received.
    const status =
      error instanceof HttpError
        ? error.status
        : HandledError.isHandled(error)
          ? (error.httpStatus as ContentfulStatusCode)
          : (((error as { status?: ContentfulStatusCode }).status ?? 500) as ContentfulStatusCode);

    // A refusal the caller can act on is their fact, not our outage: logging
    // a 404 or a 422 at error level with a "[500]" in the sentence buries the
    // real failures under the routine ones.
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
      `${options.label} [${status}]: ${error.message || String(error)}`,
    );

    if (error instanceof HttpError) {
      return c.json(errorSchema.parse(error), error.status);
    }

    // A handled error already knows its own status, code, meta, reasons and
    // remediation — collapsing it to a 500 here would throw all of that away
    // and report the caller's mistake as our outage. This handler exists to
    // add the family's domain mapping on top of the shared boundary, not to
    // replace it, so anything it has not specifically claimed goes on.
    if (HandledError.isHandled(error)) return options.boundary(error, c);

    const internalError = new InternalServerError();
    return c.json(errorSchema.parse(internalError), internalError.status);
  };
}
