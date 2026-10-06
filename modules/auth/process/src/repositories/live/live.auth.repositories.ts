import type { RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import type { AuthRepositories } from "../auth.repositories.ts";
import { PostgresAuthRepositories } from "../prisma/prisma.auth.repositories.ts";
import { PrismaSignInSecuritySettingsRepository } from "../prisma/prisma.sign-in-security-settings.repository.ts";
import { RedisAuthRateLimitRepository } from "../redis/redis.auth-rate-limit.repository.ts";
import { RedisCliDeviceSessionRepository } from "../redis/redis.cli-device-session.repository.ts";

/** Auth's live stores: durable browser rows in Prisma and TTL'd CLI grants in Redis. */
export class LiveAuthRepositories {
  static readonly requires = ["prisma", "redis", "rateLimiter"] as const;
  static readonly repositories = PostgresAuthRepositories.repositories;

  static create({
    prisma,
    redis,
    rateLimiter,
  }: {
    prisma: Parameters<typeof PostgresAuthRepositories.create>[0]["prisma"];
    redis: RedisConnection;
    rateLimiter: RateLimiter;
  }): AuthRepositories {
    return {
      ...PostgresAuthRepositories.create({ prisma }),
      cliSessions: RedisCliDeviceSessionRepository.create(redis),
      signInSecurity: PrismaSignInSecuritySettingsRepository.create(prisma),
      rateLimits: RedisAuthRateLimitRepository.create({ limiter: rateLimiter }),
    };
  }
}
