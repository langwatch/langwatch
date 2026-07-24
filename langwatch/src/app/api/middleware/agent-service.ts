import type { MiddlewareHandler } from "hono";

import { prisma } from "~/server/db";
import { AgentService } from "~/server/agents/agent.service";

export type AgentServiceMiddlewareVariables = {
  agentService: AgentService;
};

export const agentServiceMiddleware: MiddlewareHandler = async (c, next) => {
  c.set("agentService", AgentService.create(prisma));
  await next();
};
