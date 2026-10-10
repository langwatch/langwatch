import type { RedisConnection } from "@langwatch/redis-client";

import { PrismaGdprUserDataEraseRepository } from "../prisma/prisma.user-data-erase.repository.ts";
import { PrismaUserOrganizationDirectoryRepository } from "../prisma/prisma.user-organization-directory.repository.ts";
import { PostgresUserRepositories } from "../prisma/prisma.user.repositories.ts";
import { RedisUserRateLimitRepository } from "../redis/redis.user-rate-limit.repository.ts";
import type { UserRepositories } from "../user.repositories.ts";

/** User's live stores: accounts and the directory reads in Postgres, throttle windows in Redis. */
export class LiveUserRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresUserRepositories.create>[0]["prisma"];
    redis: RedisConnection;
  }>): UserRepositories {
    return {
      ...PostgresUserRepositories.create({ prisma }),
      rateLimits: RedisUserRateLimitRepository.create({ redis }),
      organizationDirectory: PrismaUserOrganizationDirectoryRepository.create({ prisma }),
      dataErase: PrismaGdprUserDataEraseRepository.create({ database: prisma }),
    };
  }
}
