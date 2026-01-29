import type { Context, Next } from "hono";

import { createLogger } from "../../../utils/logger";
import {
  createContextFromHono,
  runWithContext,
} from "../../../server/context/asyncContext";
import { observeHttpRequestDuration } from "../../../server/metrics";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    // Create context from Hono context and run within it
    const ctx = createContextFromHono(c);

    return runWithContext(ctx, async () => {
      const start = Date.now();
      let error: any = c.error;

      try {
        await next();
      } catch (err) {
        error = err;
        throw err; // Re-throw so Hono can handle the error downstream
      } finally {
        const duration = Date.now() - start;
        const { method } = c.req;
        const url = c.req.url;
        const statusCode = c.res.status || getStatusCode(error);

        // Extract path for metrics (without query params)
        const urlPath = new URL(url).pathname;

        // Record HTTP request duration metric with context
        observeHttpRequestDuration(method, urlPath, statusCode, duration / 1000, {
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          userId: ctx.userId,
        });

        // Logger automatically includes context (traceId, spanId, etc.)
        const logData: Record<string, unknown> = {
          method,
          url,
          statusCode,
          duration,
          userAgent: c.req.header("user-agent") ?? null,
        };

        if (error || c.error) {
          logData.error = error;
          logger.error(logData, "error handling request");
        } else {
          logger.info(logData, "request handled");
        }
      }
    });
  };
};

function getStatusCode(error: unknown): number {
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  if (error) {
    return 500;
  }

  return 200;
}
