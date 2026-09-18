import { defineRepositories } from "@langwatch/kernel";
import { prismaRepositories } from "@langwatch/prisma-client";

import { MemoryAgentRepositories } from "./memory/memory.agent.repositories.ts";
import { PrismaAgentRepository } from "./prisma/prisma.agent.repository.ts";

export const agentRepositories = defineRepositories({
  live: prismaRepositories({ agents: PrismaAgentRepository }),
  memory: MemoryAgentRepositories,
});
