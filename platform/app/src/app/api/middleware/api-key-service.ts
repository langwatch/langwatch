import type { MiddlewareHandler } from "hono";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";

export type ApiKeyServiceMiddlewareVariables = {
  apiKeyService: ApiKeyService;
};

export const apiKeyServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("apiKeyService", ApiKeyService.create(prisma));
  await next();
};
