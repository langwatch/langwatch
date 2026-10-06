import type { RedisConnection } from "@langwatch/redis-client";

import type { OpsRepositories } from "../ops.repositories.ts";
import { PostgresOpsRepositories } from "../prisma/prisma.ops.repositories.ts";
import { RedisMigrationLeaseRepository } from "../redis/redis.migration-lease.repository.ts";

/** Ops' live stores: its rows in Postgres, the migration pass's lease in Redis. */
export const LiveOpsRepositories = {
  ...PostgresOpsRepositories,
  requires: ["prisma", "redis"] as const,
  create: ({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresOpsRepositories.create>[0]["prisma"];
    redis: RedisConnection;
  }>): OpsRepositories => ({
    ...PostgresOpsRepositories.create({ prisma }),
    migrationLease: RedisMigrationLeaseRepository.create({ redis }),
  }),
};
