import { createLogger } from "@langwatch/observability";
import {
  getStatusCodeFromError,
  logHttpRequest,
} from "@langwatch/observability/request";
import type { Context, Next } from "hono";
import {
  createContextFromHono,
  runWithContext,
} from "../../../server/context/asyncContext";
import { claimOncePerRequest } from "./request-once";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    // Every SecuredApp registers this and the families sharing basePath "/api"
    // all match the same request — log it for the outermost one only.
    if (!claimOncePerRequest(c.req.raw, "logger")) return next();

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
        const statusCode = error ? getStatusCodeFromError(error) : c.res.status;

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
