import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { PromptService } from "~/server/prompt-config/prompt.service";

export type PromptServiceMiddlewareVariables = {
  promptService: PromptService;
};

export const promptServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("promptService", new PromptService(prisma));
  await next();
};
