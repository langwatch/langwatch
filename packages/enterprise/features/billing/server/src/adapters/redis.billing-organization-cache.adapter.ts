// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Cluster, Redis } from "ioredis";
import {
  BILLING_ORG_CACHE_PREFIX,
  BILLING_ORG_CACHE_TTL_MS,
  type BillingOrganizationCache,
} from "./eventing.report-usage-for-month.adapter";
import type { BillingReportOrganization } from "../ports/billing-report-organization.port";

/** Only what this cache calls, so a test double is a two-method object. */
export type BillingOrganizationCacheRedis = Pick<Redis | Cluster, "get" | "setex">;

/**
 * The billing organization read, cached in the process's own Redis.
 *
 * Frozen twin: the App caches the same read through its own
 * `TtlCache<CachedOrgData>(BILLING_ORG_CACHE_TTL_MS, BILLING_ORG_CACHE_PREFIX)`
 * (`platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts`),
 * over the same Redis, storing `JSON.stringify(value)` under the same key. The
 * prefix and the lifetime are the cache's identity across every pod and both
 * graphs, which is why they are the constants this module imports rather than
 * numbers it restates: a drifted prefix leaves each graph reading a cache the
 * other never writes, and a drifted TTL has each side expiring the other's
 * entries early.
 *
 * A read or write Redis refuses is swallowed on purpose. The cache exists to
 * spare Postgres one lookup per organization per minute; an unreachable Redis
 * has to degrade to the database rather than stop a month being reported.
 */
export class RedisBillingOrganizationCacheAdapter implements BillingOrganizationCache {
  static create(options: {
    redis: BillingOrganizationCacheRedis;
  }): RedisBillingOrganizationCacheAdapter {
    return new RedisBillingOrganizationCacheAdapter(options.redis);
  }

  private constructor(private readonly redis: BillingOrganizationCacheRedis) {}

  async get(key: string): Promise<BillingReportOrganization | undefined> {
    try {
      const stored = await this.redis.get(`${BILLING_ORG_CACHE_PREFIX}${key}`);
      if (stored === null) return undefined;
      return JSON.parse(stored) as BillingReportOrganization;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: BillingReportOrganization): Promise<void> {
    try {
      await this.redis.setex(
        `${BILLING_ORG_CACHE_PREFIX}${key}`,
        Math.ceil(BILLING_ORG_CACHE_TTL_MS / 1000),
        JSON.stringify(value),
      );
    } catch {
      // The database already answered; a cache that cannot remember is not a
      // reason to leave a month unreported.
    }
  }
}
