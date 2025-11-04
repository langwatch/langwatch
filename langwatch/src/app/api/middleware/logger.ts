import type { Context, Next } from "hono";

import { createLogger } from "../../../utils/logger";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    const start = Date.now();
    let error: any = c.error;

    try {
      await next();
    } catch (err) {
      error = err;
      // Log error immediately before re-throwing
      const status = (err as any)?.status ?? 500;
      logger.error(
        {
          method: c.req.method,
          url: c.req.url,
          path: c.req.path,
          status,
          error: err instanceof Error ? {
            name: err.name,
            message: err.message,
            stack: err.stack,
          } : err,
        },
        `Request error [${status}]: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err; // Re-throw so Hono can handle the error downstream
    } finally {
      const duration = Date.now() - start;
      const { method } = c.req;
      const url = c.req.url;
      const statusCode = c.res.status || (error ? ((error as any)?.status ?? 500) : 200);

      const logData: Record<string, unknown> = {
        method,
        url,
        statusCode,
        duration,
        userAgent: c.req.header("user-agent") ?? null,
        userId: c.get("user")?.id ?? null,
        projectId: c.get("project")?.id ?? null,
        organizationId: c.get("organization")?.id ?? null,
      };

      if (error || c.error) {
        logData.error = error instanceof Error ? error : JSON.stringify(error);
        logger.error(logData, "error handling request");
      } else {
        logger.info(logData, "request handled");
      }
    }
  };
};
