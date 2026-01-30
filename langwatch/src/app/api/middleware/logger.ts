import type { Context, Next } from "hono";

import { createLogger } from "../../../utils/logger";
import {
  createContextFromHono,
  runWithContext,
} from "../../../server/context/asyncContext";
import { observeHttpRequestDuration } from "../../../server/metrics";
import {
  getStatusCodeFromError,
  logHttpRequest,
} from "../../../server/middleware/requestLogging";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    // Create context from Hono context and run within it
    const ctx = createContextFromHono(c);

    return runWithContext(ctx, async () => {
      const start = Date.now();
      let error: unknown = c.error;

      try {
        await next();
      } catch (err) {
        error = err;
        throw err; // Re-throw so Hono can handle the error downstream
      } finally {
        const duration = Date.now() - start;
        const { method } = c.req;
        const url = c.req.url;
        const statusCode = c.res.status || getStatusCodeFromError(error);

        // Log the request
        logHttpRequest(logger, {
          method,
          url,
          statusCode,
          duration,
          userAgent: c.req.header("user-agent") ?? null,
          error: error || c.error,
        });
      }
    });
  };
};
