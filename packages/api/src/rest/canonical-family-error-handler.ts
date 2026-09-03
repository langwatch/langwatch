import type { Context, ErrorHandler } from "hono";

import { createLogger } from "@langwatch/observability";

import type { ApiErrorBody } from "./schemas.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * A canonical-envelope family's own `onError`: its log line over the one
 * shared mapping.
 *
 * A family publishing the canonical envelope has no rendering of its own to
 * add — the shared mapper already turns every `HandledError`, every
 * status-carrying `HttpError` and every unexpected failure into one taxonomy,
 * and a second mapping here is exactly the drift that module exists to
 * prevent. What a family does want is its own name on the log line, and the
 * status and code the caller actually received on it, so a webhook refusal is
 * findable as a webhook refusal.
 *
 * Installing an `onError` REPLACES the one the spine installed, so `mapError`
 * is not optional: without it a family that logged would stop answering
 * canonically. The domain failures keep their own codes because they are
 * `HandledError`s, so the shared mapper names them without this boundary
 * knowing they exist. That matters beyond tidiness: the codes registry guard
 * only sees codes declared on handled errors, so a code named by hand here
 * would be one nothing checks has customer-facing copy.
 */
export function createCanonicalFamilyErrorHandler(options: {
  /** e.g. `langwatch:api:webhooks:errors`. */
  loggerName: string;
  /** e.g. `Webhooks API Error`, the prefix on the logged sentence. */
  label: string;
  /** The process's canonical mapping, with the request's trace ids folded in. */
  mapError: (
    error: unknown,
    c: Context<any>,
  ) => { status: ContentfulStatusCode; body: ApiErrorBody };
}): ErrorHandler {
  const logger = createLogger(options.loggerName);

  return async (error, c) => {
    const { status, body } = options.mapError(error, c);

    logger.error(
      {
        path: c.req.path,
        method: c.req.method,
        status,
        code: body.error.code,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      },
      `${options.label} [${status}]: ${error.message || String(error)}`,
    );

    return c.json(body, status);
  };
}
