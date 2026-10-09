// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { BillingRepositories } from "../billing.repositories.ts";
import { ClickHouseBillingGatewaySpendRepository } from "../clickhouse/clickhouse.billing-gateway-spend.repository.ts";
import { PostgresBillingRepositories } from "../prisma/prisma.billing.repositories.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "../redis/redis.billing-organization-cache.repository.ts";

/** Billing's rows over Postgres, the organization cache over Redis, gateway's shared ledger in ClickHouse. */
export class LiveBillingRepositories {
  static readonly requires = ["prisma", "redis", "clickhouse"] as const;

  static create({
    prisma,
    redis,
    clickhouse,
  }: Readonly<{
    prisma: Parameters<typeof PostgresBillingRepositories.create>[0]["prisma"];
    redis: BillingOrganizationCacheRedis;
    clickhouse: ClickHouseQueryClient;
  }>): BillingRepositories {
    return {
      ...PostgresBillingRepositories.create({ prisma }),
      organizationCache: RedisBillingOrganizationCacheRepository.create({ redis }),
      gatewaySpend: ClickHouseBillingGatewaySpendRepository.create(clickhouse),
    };
  }
}
