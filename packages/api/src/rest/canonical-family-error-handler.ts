import type { Context, ErrorHandler } from "hono";

import { createLogger } from "@langwatch/observability";

import type { ApiErrorBody } from "./schemas.ts";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * A canonical-envelope family's own `onError`: its log line over the one
 * shared mapping. Installing an `onError` REPLACES the spine's, so
 * `mapError` is not optional — without it a family that logged would stop
 * answering canonically. Domain failures keep their own codes as
 * `HandledError`s, so the codes registry guard still sees them declared.
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
