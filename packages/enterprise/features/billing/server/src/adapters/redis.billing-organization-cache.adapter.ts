// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Cluster, Redis } from "ioredis";
import {
  BILLING_ORG_CACHE_PREFIX,
  BILLING_ORG_CACHE_TTL_MS,
  type BillingOrganizationCache,
} from "./eventing.report-usage-for-month.adapter";
import type { BillingReportOrganizationLookup } from "../ports/billing-report-organization.port";

/** Only what this cache calls, so a test double is a two-method object. */
export type BillingOrganizationCacheRedis = Pick<Redis | Cluster, "get" | "setex">;

/**
 * The billing organization read, cached in the process's own Redis.
 *
 * The whole lookup VERDICT is stored, not just a hit: an organization that
 * does not buy usage reaches this handler on every dispatch and can never do
 * anything here, so caching only the hits left exactly those organizations
 * paying for the query every time.
 *
 * The prefix and the lifetime are the cache's identity across every pod, which
 * is why they are the constants this module imports rather than numbers it
 * restates: a drifted prefix leaves each pod reading a cache the others never
 * write, and a drifted lifetime has one side expiring another's entries early.
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

  async get(key: string): Promise<BillingReportOrganizationLookup | undefined> {
    try {
      const stored = await this.redis.get(`${BILLING_ORG_CACHE_PREFIX}${key}`);
      if (stored === null) return undefined;
      return JSON.parse(stored) as BillingReportOrganizationLookup;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: BillingReportOrganizationLookup): Promise<void> {
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
