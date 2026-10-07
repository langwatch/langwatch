// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BillingRepositories } from "../billing.repositories.ts";
import { PostgresBillingRepositories } from "../prisma/prisma.billing.repositories.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "../redis/redis.billing-organization-cache.repository.ts";

/** Billing's rows over Postgres, the organization cache over Redis. */
export class LiveBillingRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresBillingRepositories.create>[0]["prisma"];
    redis: BillingOrganizationCacheRedis;
  }>): BillingRepositories {
    return {
      ...PostgresBillingRepositories.create({ prisma }),
      organizationCache: RedisBillingOrganizationCacheRepository.create({ redis }),
    };
  }
}
