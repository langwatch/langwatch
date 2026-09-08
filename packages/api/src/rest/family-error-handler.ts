import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { HttpError, InternalServerError, isFrameworkRefusal } from "./http-errors.ts";
import { errorSchema } from "./schemas.ts";

/**
 * A family's own `onError`: its domain mapping layered over the process's
 * boundary handler (`legacyErrorHandler`). Delegates anything unclaimed so
 * a handled error keeps its code/meta/reasons; only the logger's name and
 * prefix differ between families.
 */

/** The status precedence: a family's {@link HttpError}, a handled error's
 *  own status, a framework refusal's, else an internal 500. */
function resolveResponseStatus(error: unknown): ContentfulStatusCode {
  if (error instanceof HttpError) return error.status;
  if (HandledError.isHandled(error)) return error.httpStatus as ContentfulStatusCode;
  if (isFrameworkRefusal(error)) return error.status;
  return 500;
}

export function createFamilyErrorHandler(options: {
  /** e.g. `langwatch:api:api-keys:errors`. */
  loggerName: string;
  /** e.g. `API Keys Error`, the prefix on the logged sentence. */
  label: string;
  boundary: ErrorHandler;
  mapError?: (error: Error) => Error;
  headers?: (error: Error) => Readonly<Record<string, string>>;
}): ErrorHandler {
  const logger = createLogger(options.loggerName);

  return async (error, c) => {
    error = options.mapError?.(error) ?? error;
    for (const [name, value] of Object.entries(options.headers?.(error) ?? {})) {
      c.header(name, value);
    }
    // Same order as the response dispatch below, so the logged status is
    // always the status the caller received.
    const status = resolveResponseStatus(error);

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
    // A framework refusal — Hono's own `HTTPException` — carries a status the
    // caller can act on, and the boundary renders it. Collapsing it here would
    // answer a handler's 404 as our outage.
    const isDomainOrFrameworkHandled = HandledError.isHandled(error) || isFrameworkRefusal(error);
    if (isDomainOrFrameworkHandled) {
      return options.boundary(error, c);
    }

    const internalError = new InternalServerError();
    return c.json(errorSchema.parse(internalError), internalError.status);
  };
}
