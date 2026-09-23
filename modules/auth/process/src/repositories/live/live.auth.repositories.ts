import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";

import type { AuthRepositories } from "../auth.repositories.ts";
import { PostgresAuthRepositories } from "../prisma/prisma.auth.repositories.ts";
import { PrismaSignInSecuritySettingsRepository } from "../prisma/prisma.sign-in-security-settings.repository.ts";
import { RedisCliDeviceSessionRepository } from "../redis/redis.cli-device-session.repository.ts";

/** Auth's live stores: durable browser rows in Prisma and TTL'd CLI grants in Redis. */
export class LiveAuthRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresAuthRepositories.repositories;

  static create({
    prisma,
    redis,
  }: {
    prisma: PrismaClient;
    redis: RedisConnection;
  }): AuthRepositories {
    return {
      ...PostgresAuthRepositories.create({ prisma }),
      cliSessions: RedisCliDeviceSessionRepository.create(redis),
      signInSecurity: PrismaSignInSecuritySettingsRepository.create(prisma),
    };
  }
}
