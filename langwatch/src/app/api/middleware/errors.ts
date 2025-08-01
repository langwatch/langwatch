import type { MiddlewareHandler } from "hono";

import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:errors");

/**
 * Error handling middleware that catches errors and formats responses
 */
export const errorMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (error: any) {
    const projectId = c.get("project")?.id;
    const path = c.req.path;
    const method = c.req.method;
    const routeParams = c.req.param();

    // Log the error with context
    logger.error(
      {
        projectId,
        path,
        method,
        routeParams,
        error: error.message || String(error),
        stack: error.stack,
      },
      `API Error: ${error.message || String(error)}`
    );

    // Check if it's a "not found" error
    const isNotFoundError =
      error.message?.includes("not found") ||
      // Prisma error code for "not found"
      error.code === "P2025";

    if (isNotFoundError) {
      return c.json({ error: error.message }, 404);
    }

    if (error.status) {
      return c.json({ error: error.message }, error.status);
    }

    // Otherwise treat as server error
    return c.json(
      {
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && {
          message: error.message,
        }),
      },
      500
    );
  }
};
