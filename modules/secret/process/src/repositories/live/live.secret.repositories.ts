import type { RedisConnection } from "@langwatch/redis-client";

import { PostgresSecretRepositories } from "../prisma/prisma.secret.repositories.ts";
import { RedisOneTimeRevealRepository } from "../redis/redis.one-time-reveal.repository.ts";
import type { SecretRepositories } from "../secret.repositories.ts";

/** The Postgres half's own input, so the generated client is named where the
 *  repositories under `prisma/` name it and not a second time here. */
type PostgresInput = Parameters<typeof PostgresSecretRepositories.create>[0];

/** Secret's live stores: durable project secrets in Postgres, and one-time
 *  reveals in Redis, where every replica reads the same parked value. */
export class LiveSecretRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresSecretRepositories.repositories;

  static create({ prisma, redis }: PostgresInput & { redis: RedisConnection }): SecretRepositories {
    return {
      ...PostgresSecretRepositories.create({ prisma }),
      reveals: RedisOneTimeRevealRepository.create({ redis }),
    };
  }
}
