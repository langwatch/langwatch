import type { RedisConnection } from "@langwatch/redis-client";

import { PrismaSecretRepository, type SecretDatabase } from "../prisma/prisma.secret.repository.ts";
import { RedisOneTimeRevealRepository } from "../redis/redis.one-time-reveal.repository.ts";
import type { SecretCipher, SecretRepositories } from "../secret.repositories.ts";

/**
 * Secret's live stores: durable project secrets in Postgres, and one-time reveals in
 * Redis, where every replica reads the same parked value. Both seal with the process's
 * cipher; a process with no key refuses at boot naming `encryption`.
 */
export class LiveSecretRepositories {
  static readonly requires = ["prisma", "encryption", "redis"] as const;
  static readonly repositories = { secrets: { tables: PrismaSecretRepository.tables } };

  static create({
    prisma,
    encryption,
    redis,
  }: Readonly<{
    prisma: SecretDatabase;
    encryption: SecretCipher;
    redis: RedisConnection;
  }>): SecretRepositories {
    return {
      secrets: PrismaSecretRepository.create({ prisma, cipher: encryption }),
      reveals: RedisOneTimeRevealRepository.create({ redis, cipher: encryption }),
    };
  }
}
