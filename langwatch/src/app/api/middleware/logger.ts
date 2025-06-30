import type { Context, Next } from "hono";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("langwatch:api:hono");

export const loggerMiddleware = () => {
  return async (c: Context, next: Next): Promise<any> => {
    const start = Date.now();
    let error: unknown = null;

    try {
      await next();
    } catch (err) {
      error = err;
      throw err; // Re-throw so Hono can handle the error downstream
    } finally {
      const duration = Date.now() - start;
      const { method } = c.req;
      const url = c.req.url;
      const statusCode = c.res.status;

      const logData: Record<string, unknown> = {
        method,
        url,
        statusCode,
        duration,
        userAgent: c.req.header("user-agent"),
        userId: c.get("user")?.id,
        projectId: c.get("project")?.id,
        organizationId: c.get("organization")?.id,
      };

      if (error) {
        logData.error = error instanceof Error ? error : JSON.stringify(error);
        logger.error(logData, "error handling request");
      } else {
        logger.info(logData, "request handled");
      }
    }
  };
};
