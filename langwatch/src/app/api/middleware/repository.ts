import { type MiddlewareHandler } from "hono";
import { prisma } from "~/server/db";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";

export const repositoryMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("llmConfigRepository", new LlmConfigRepository(prisma));

  return next();
};
