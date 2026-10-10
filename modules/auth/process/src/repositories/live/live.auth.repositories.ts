import type { Encryption, RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import type { AuthRepositories } from "../auth.repositories.ts";
import { MemoryBetterAuthSecondaryStorageRepository } from "../memory/memory.better-auth-secondary-storage.repository.ts";
import { PrismaAuthDirectoryRepository } from "../prisma/prisma.auth-directory.repository.ts";
import { PostgresAuthRepositories } from "../prisma/prisma.auth.repositories.ts";
import { PrismaBetterAuthHooksRepository } from "../prisma/prisma.better-auth-hooks.repository.ts";
import {
  type AuthDatabase,
  PrismaBetterAuthStorageRepository,
} from "../prisma/prisma.better-auth-storage.repository.ts";
import { PrismaPendingSsoSetupRepository } from "../prisma/prisma.pending-sso-setup.repository.ts";
import { RedisAuthRateLimitRepository } from "../redis/redis.auth-rate-limit.repository.ts";
import { RedisAuthSessionCacheRepository } from "../redis/redis.auth-session-cache.repository.ts";
import { RedisBetterAuthSecondaryStorageRepository } from "../redis/redis.better-auth-secondary-storage.repository.ts";
import { RedisCliDeviceSessionRepository } from "../redis/redis.cli-device-session.repository.ts";

/**
 * Auth's live stores: durable browser rows in Prisma and TTL'd CLI grants in Redis.
 * A process without Redis keeps Better Auth's drop-and-warn secondary storage.
 */
export class LiveAuthRepositories {
  static readonly requires = ["prisma", "redis", "rateLimiter", "encryption"] as const;
  static readonly repositories = PostgresAuthRepositories.repositories;

  static create({
    prisma,
    redis,
    rateLimiter,
    encryption,
  }: {
    prisma: AuthDatabase;
    redis: RedisConnection;
    rateLimiter: RateLimiter;
    encryption: Encryption;
  }): AuthRepositories {
    return {
      ...PostgresAuthRepositories.create({ prisma }),
      cliSessions: RedisCliDeviceSessionRepository.create(redis),
      rateLimits: RedisAuthRateLimitRepository.create({ limiter: rateLimiter }),
      betterAuthStorage: PrismaBetterAuthStorageRepository.create({ prisma, encryption }),
      betterAuthSecondaryStorage: redis
        ? RedisBetterAuthSecondaryStorageRepository.create(redis)
        : MemoryBetterAuthSecondaryStorageRepository.create(),
      betterAuthHooks: PrismaBetterAuthHooksRepository.create(prisma),
      directory: PrismaAuthDirectoryRepository.create(prisma),
      pendingSsoSetup: PrismaPendingSsoSetupRepository.create(prisma),
      sessionCache: RedisAuthSessionCacheRepository.create({ redis }),
    };
  }
}
