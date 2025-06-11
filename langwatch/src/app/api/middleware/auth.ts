import { type MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:api:auth");

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  if (!apiKey) {
    return c.json({ error: "Unauthorized", message: "Missing API key" }, 401);
  }

  try {
    const project = await prisma.project.findUnique({
      where: { apiKey },
    });

    if (!project) {
      return c.json({ error: "Unauthorized", message: "Invalid API key" }, 401);
    }

    // Store project and repository for use in route handlers
    c.set("project", project);

    return next();
  } catch (error) {
    // Log with structured context for debugging
    logger.error(
      {
        error,
        path: c.req.path,
        method: c.req.method,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey?.substring(0, 8) + "...", // Safe logging of key prefix
      },
      "Database error during authentication"
    );

    // Return 500 since auth failure due to database issues is a server error,
    // not a service unavailability issue
    return c.json(
      {
        error: "Internal Server Error",
        message: "Authentication service error",
      },
      500
    );
  }
};
