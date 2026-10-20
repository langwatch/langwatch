import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RedisConnection } from "@langwatch/redis-client";

import { ClickHousePrivateClickHouseRoutesRepository } from "../clickhouse/clickhouse.private-clickhouse-routes.repository.ts";
import { ObjectStoragePrivateS3AccountsRepository } from "../object-storage/object-storage.private-s3-accounts.repository.ts";
import type { OrganizationRepositories } from "../organization.repositories.ts";
import { PostgresOrganizationRepositories } from "../prisma/prisma.organization.repositories.ts";
import { RedisOrganizationInviteRateLimitRepository } from "../redis/redis.organization-invite-rate-limit.repository.ts";

/**
 * Organization's live stores: Postgres rows sealed by the cipher; the invite counter in Redis; the
 * private route variables ClickHouse and object storage were configured with.
 */
export class LiveOrganizationRepositories {
  static readonly requires = [
    "prisma",
    "encryption",
    "redis",
    "clickhouse",
    "objectStorage",
  ] as const;

  static create({
    prisma,
    encryption,
    redis,
    clickhouse,
    objectStorage,
  }: Readonly<{
    prisma: Parameters<typeof PostgresOrganizationRepositories.create>[0]["prisma"];
    encryption: Parameters<typeof PostgresOrganizationRepositories.create>[0]["encryption"];
    redis: RedisConnection;
    clickhouse: ClickHouseQueryClient;
    objectStorage: Parameters<
      typeof ObjectStoragePrivateS3AccountsRepository.create
    >[0]["objectStorage"];
  }>): OrganizationRepositories {
    return {
      ...PostgresOrganizationRepositories.create({ prisma, encryption }),
      inviteRateLimit: RedisOrganizationInviteRateLimitRepository.create(redis),
      privateClickHouseRoutes: ClickHousePrivateClickHouseRoutesRepository.create({ clickhouse }),
      privateS3Accounts: ObjectStoragePrivateS3AccountsRepository.create({ objectStorage }),
    };
  }
}
