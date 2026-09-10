import { defineRepositories } from "@langwatch/runtime-composition";
import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaAgentRepository } from "./prisma/prisma.agent.repository.ts";
import { MemoryAgentRepositories } from "./memory/memory.agent.repositories.ts";

export const agentRepositories = defineRepositories({
  live: prismaRepositories({ agents: PrismaAgentRepository }),
  memory: MemoryAgentRepositories,
});
