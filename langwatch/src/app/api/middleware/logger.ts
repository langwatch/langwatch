import { createLogger } from "@langwatch/observability";
import {
  getStatusCodeFromError,
  logHttpRequest,
} from "@langwatch/observability/request";
import type { Context, Next } from "hono";
import {
  createContextFromHono,
  getCurrentContext,
  runWithContext,
} from "../../../server/context/asyncContext";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    // The async request context doubles as the "this request is already being
    // handled" signal: the outermost logger establishes it below, so if it
    // already exists this invocation is one of the duplicate middleware
    // entries the SecuredApp families sharing basePath "/api" all register —
    // every family's middleware matches every /api request. Also covers
    // internal re-dispatches (legacy OAuth rewrite), which log once as the
    // original request instead of twice.
    if (getCurrentContext()) return next();

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
