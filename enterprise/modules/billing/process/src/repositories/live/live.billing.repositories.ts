// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { BillingRepositories } from "../billing.repositories.ts";
import { BillableEventsClickHouseRepository } from "../clickhouse/clickhouse.billable-events.repository.ts";
import { PostgresBillingRepositories } from "../prisma/prisma.billing.repositories.ts";
import {
  RedisBillingOrganizationCacheAdapter,
  type BillingOrganizationCacheRedis,
} from "../redis/redis.billing-organization-cache.repository.ts";

/** Billing's rows over Postgres, the month's billable total over ClickHouse, the cache over Redis. */
export class LiveBillingRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresBillingRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    redis: BillingOrganizationCacheRedis;
  }>): BillingRepositories {
    return {
      ...PostgresBillingRepositories.create({ prisma }),
      billableEvents: BillableEventsClickHouseRepository.create(clickhouse),
      organizationCache: RedisBillingOrganizationCacheAdapter.create({ redis }),
    };
  }
}
