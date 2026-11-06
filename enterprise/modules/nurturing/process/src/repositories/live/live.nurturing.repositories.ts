// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingRepositories } from "../nurturing.repositories.ts";
import {
  type NurturingOperatorReadsMember,
  PrismaNurturingUsageOrganizationsRepository,
} from "../prisma/prisma.nurturing-usage-organizations.repository.ts";
import { PostgresNurturingRepositories } from "../prisma/prisma.nurturing.repositories.ts";
import {
  type NurturingClaimRedis,
  RedisNurturingClaimRepository,
} from "../redis/redis.nurturing-claim.repository.ts";

/** Nurturing's live stores: its milestones in Postgres, its delivery claims in Redis. */
export class LiveNurturingRepositories {
  static readonly requires = ["prisma", "redis", "operatorReads"] as const;
  static readonly repositories = PostgresNurturingRepositories.repositories;

  static create({
    prisma,
    redis,
    operatorReads,
  }: Readonly<{
    prisma: Parameters<typeof PostgresNurturingRepositories.create>[0]["prisma"];
    redis: NurturingClaimRedis;
  }> &
    NurturingOperatorReadsMember): NurturingRepositories {
    return {
      ...PostgresNurturingRepositories.create({ prisma }),
      claims: RedisNurturingClaimRepository.create({ redis }),
      usageOrganizations: PrismaNurturingUsageOrganizationsRepository.create({ operatorReads }),
    };
  }
}
