// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingRepositories } from "../nurturing.repositories.ts";
import { PostgresNurturingRepositories } from "../prisma/prisma.nurturing.repositories.ts";
import {
  type NurturingClaimRedis,
  RedisNurturingClaimRepository,
} from "../redis/redis.nurturing-claim.repository.ts";

/** Nurturing's live stores: its milestones in Postgres, its delivery claims in Redis. */
export class LiveNurturingRepositories {
  static readonly requires = ["prisma", "redis"] as const;
  static readonly repositories = PostgresNurturingRepositories.repositories;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresNurturingRepositories.create>[0]["prisma"];
    redis: NurturingClaimRedis;
  }>): NurturingRepositories {
    return {
      ...PostgresNurturingRepositories.create({ prisma }),
      claims: RedisNurturingClaimRepository.create({ redis }),
    };
  }
}
