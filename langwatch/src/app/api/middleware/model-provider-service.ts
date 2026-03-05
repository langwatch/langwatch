import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { ModelProviderService } from "~/server/modelProviders/modelProvider.service";

export type ModelProviderServiceMiddlewareVariables = {
  modelProviderService: ModelProviderService;
};

export const modelProviderServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("modelProviderService", ModelProviderService.create(prisma));
  await next();
};
