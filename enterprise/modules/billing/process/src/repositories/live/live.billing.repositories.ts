// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { BillingRepositories } from "../billing.repositories.ts";
import { BillableEventsMeterClickHouseRepository } from "../clickhouse/clickhouse.billable-events-meter.repository.ts";
import { BillableEventsClickHouseRepository } from "../clickhouse/clickhouse.billable-events.repository.ts";
import { PostgresBillingRepositories } from "../prisma/prisma.billing.repositories.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "../redis/redis.billing-organization-cache.repository.ts";
import {
  RedisScenarioRunMilestoneClaimRepository,
  type ScenarioRunMilestoneClaimRedis,
} from "../redis/redis.scenario-run-milestone-claim.repository.ts";
import {
  RedisBillingTenantOrganizationCacheRepository,
  type BillingTenantOrganizationCacheRedis,
} from "../redis/redis.tenant-organization-cache.repository.ts";

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
    redis: BillingOrganizationCacheRedis &
      ScenarioRunMilestoneClaimRedis &
      BillingTenantOrganizationCacheRedis;
  }>): BillingRepositories {
    return {
      ...PostgresBillingRepositories.create({ prisma }),
      billableEvents: BillableEventsClickHouseRepository.create(clickhouse),
      billableEventsMeter: BillableEventsMeterClickHouseRepository.create(clickhouse),
      organizationCache: RedisBillingOrganizationCacheRepository.create({ redis }),
      scenarioRunMilestoneClaims: RedisScenarioRunMilestoneClaimRepository.create({ redis }),
      tenantOrganizationCache: RedisBillingTenantOrganizationCacheRepository.create({ redis }),
    };
  }
}
