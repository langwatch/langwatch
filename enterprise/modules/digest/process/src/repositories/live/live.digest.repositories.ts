// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestRepositories } from "../digest.repositories.ts";
import { PostgresDigestRepositories } from "../prisma/prisma.digest.repositories.ts";
import {
  type DigestCallCounterRedis,
  RedisDigestCallCounterRepository,
} from "../redis/redis.digest-call-counter.repository.ts";

/** Digest's live stores: its rows in Postgres, the unsubscribe pages' call counts in Redis. */
export class LiveDigestRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresDigestRepositories.repositories;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresDigestRepositories.create>[0]["prisma"];
    redis: DigestCallCounterRedis;
  }>): DigestRepositories {
    return {
      ...PostgresDigestRepositories.create({ prisma }),
      callCounter: RedisDigestCallCounterRepository.create({ redis }),
    };
  }
}
