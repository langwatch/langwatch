import type { MiddlewareHandler } from "hono";
import { LegacyAgentsRestFeature } from "~/runtime/app/legacy-rest/agents";
import { prisma } from "~/server/db";

export type AgentServiceMiddlewareVariables = {
  agentService: ReturnType<typeof LegacyAgentsRestFeature.create>;
};

export const agentServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("agentService", LegacyAgentsRestFeature.create({ prisma, session: null }));
  await next();
};
