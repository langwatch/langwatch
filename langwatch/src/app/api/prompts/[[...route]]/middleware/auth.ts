import { type MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const apiKey =
    c.req.header("X-Auth-Token") ??
    c.req.header("Authorization")?.split(" ")[1];

  const project = await prisma.project.findUnique({
    where: { apiKey },
  });

  if (!project || apiKey !== project.apiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Store project and repository for use in route handlers
  c.set("project", project);
  c.set("llmConfigRepository", new LlmConfigRepository(prisma));

  return next();
};
