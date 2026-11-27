import type { EventReadSeat } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import { EventingUserStandingRepository } from "../eventing/eventing.user-standing.repository.ts";
import { PrismaGdprUserDataEraseRepository } from "../prisma/prisma.user-data-erase.repository.ts";
import { PrismaUserOrganizationDirectoryRepository } from "../prisma/prisma.user-organization-directory.repository.ts";
import { PostgresUserRepositories } from "../prisma/prisma.user.repositories.ts";
import { RedisUserRateLimitRepository } from "../redis/redis.user-rate-limit.repository.ts";
import type { UserRepositories } from "../user.repositories.ts";

/** User's live stores: accounts in Postgres, throttle windows in Redis, standing off the log. */
export class LiveUserRepositories {
  static readonly requires = ["prisma", "redis", "eventReadSeat"] as const;

  static create({
    prisma,
    redis,
    eventReadSeat,
  }: Readonly<{
    prisma: Parameters<typeof PostgresUserRepositories.create>[0]["prisma"];
    redis: RedisConnection;
    eventReadSeat: EventReadSeat;
  }>): UserRepositories {
    return {
      ...PostgresUserRepositories.create({ prisma }),
      rateLimits: RedisUserRateLimitRepository.create({ redis }),
      organizationDirectory: PrismaUserOrganizationDirectoryRepository.create({ prisma }),
      dataErase: PrismaGdprUserDataEraseRepository.create({ database: prisma }),
      standings: EventingUserStandingRepository.create({ eventReadSeat }),
    };
  }
}
