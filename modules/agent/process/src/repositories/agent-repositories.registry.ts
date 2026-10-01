import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { defineRepositories } from "@langwatch/process";
import type { RedisConnection } from "@langwatch/redis-client";

import type { AgentRepositories } from "./agent.repositories.ts";
import { MemoryAgentRepositories } from "./memory/memory.agent.repositories.ts";
import { PrismaAgentRepository } from "./prisma/prisma.agent.repository.ts";
import { RedisAgentRepositories } from "./redis/redis.agent.repositories.ts";

const prismaAgentRepositories = prismaRepositories({ agents: PrismaAgentRepository });

/** Agent rows in Postgres beside the relay's session state in Redis. */
const liveAgentRepositories = {
  requires: ["prisma", "redis"] as const,
  repositories: prismaAgentRepositories.repositories,
  create: ({
    prisma,
    redis,
  }: Readonly<{ prisma: PrismaClient; redis: RedisConnection }>): AgentRepositories => ({
    ...prismaAgentRepositories.create({ prisma }),
    ...RedisAgentRepositories.create({ redis }),
  }),
};

export const agentRepositories = defineRepositories({
  live: liveAgentRepositories,
  memory: MemoryAgentRepositories,
});
