import type { MiddlewareHandler } from "hono";
import { AgentService } from "~/server/agents/agent.service";
import { prisma } from "~/server/db";

export type AgentServiceMiddlewareVariables = {
  agentService: AgentService;
};

export const agentServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("agentService", AgentService.create(prisma));
  await next();
};
