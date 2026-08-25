import type { MiddlewareHandler } from "hono";
import type { App } from "~/server/app-layer/app";

export type ApiKeyServiceMiddlewareVariables = {
  apiKeyService: App["apiKeys"];
};

export const apiKeyServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("apiKeyService", c.var.langwatchApp.apiKeys);
  await next();
};
