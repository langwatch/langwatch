import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { defineRepositories } from "@langwatch/process";
import type { RedisConnection } from "@langwatch/redis-client";

import { MemoryOrganizationRepositories } from "./memory/memory.organization.repositories.ts";
import type { OrganizationRepositories } from "./organization.repositories.ts";
import { PostgresOrganizationRepositories } from "./prisma/prisma.organization.repositories.ts";
import { RedisOrganizationInviteRateLimitRepository } from "./redis/redis.organization-invite-rate-limit.repository.ts";

/** Organization rows in Postgres beside the invitation counter in Redis. */
const liveOrganizationRepositories = {
  requires: ["prisma", "redis"] as const,
  create: ({
    prisma,
    redis,
  }: Readonly<{ prisma: PrismaClient; redis: RedisConnection }>): OrganizationRepositories => ({
    ...PostgresOrganizationRepositories.create({ prisma }),
    inviteRateLimit: RedisOrganizationInviteRateLimitRepository.create(redis),
  }),
};

export const organizationRepositories = defineRepositories({
  live: liveOrganizationRepositories,
  memory: MemoryOrganizationRepositories,
});
