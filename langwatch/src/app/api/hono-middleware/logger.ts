import type { Context, Next } from "hono"
import { createLogger } from "~/utils/logger.server"

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
      const status = c.res.status;

      const logData: Record<string, unknown> = {
        method,
        url,
        status,
        duration,
      };

      if (error) {
        logData.err = error;
        logger.error(logData, "error handling request");
      } else {
        logger.info(logData, "request handled");
      }
    }
  };
};

