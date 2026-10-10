import type { RedisConnection } from "@langwatch/redis-client";

import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PostgresOrganizationRepositories } from "../prisma/prisma.organization.repositories.ts";
import { RedisOrganizationInviteRateLimitRepository } from "../redis/redis.organization-invite-rate-limit.repository.ts";

/** Organization's live stores: Postgres rows sealed by the cipher; the invite counter in Redis. */
export class LiveOrganizationRepositories {
  static readonly requires = ["prisma", "encryption", "redis"] as const;

  static create({
    prisma,
    encryption,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresOrganizationRepositories.create>[0]["prisma"];
    encryption: Parameters<typeof PostgresOrganizationRepositories.create>[0]["encryption"];
    redis: RedisConnection;
  }>): OrganizationRepositories {
    return {
      ...PostgresOrganizationRepositories.create({ prisma, encryption }),
      inviteRateLimit: RedisOrganizationInviteRateLimitRepository.create(redis),
    };
  }
}
