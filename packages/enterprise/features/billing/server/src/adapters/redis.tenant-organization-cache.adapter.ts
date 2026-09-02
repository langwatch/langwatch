// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Cluster, Redis } from "ioredis";
import type { BillingTenantOrganizationCache } from "../services/tenant-organization.service";

/**
 * The Redis keyspace tenant attribution occupies, and how long an answer lives.
 *
 * Frozen twin: the App resolves the same question through its own
 * `TtlCache<string>(10 * 60 * 1000, "ttlcache:org:resolve:")`
 * (`platform/app/src/server/organizations/resolveOrganizationId.ts`), over the
 * same Redis. They may only change together. A drifted prefix leaves each
 * graph reading a cache the other never writes — not an error, just two
 * populations of the same lookup paying for each other's misses — and a
 * drifted TTL has each side expiring the other's entries early.
 *
 * The value is JSON rather than the bare id for the same reason: the App
 * stores `JSON.stringify(organizationId)`, so a reader that took the raw
 * string back would hand every caller an id wrapped in quotation marks.
 */
export const BILLING_TENANT_ORGANIZATION_CACHE_PREFIX = "ttlcache:org:resolve:";
export const BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS = 10 * 60 * 1000;

/** Only what this cache calls, so a test double is a two-method object. */
export type BillingTenantOrganizationCacheRedis = Pick<Redis | Cluster, "get" | "setex">;

/**
 * Tenant attribution cached in the process's own Redis.
 *
 * A read or write that Redis refuses is swallowed on purpose. This cache
 * exists to spare Postgres a lookup whose answer cannot change — a project
 * belongs to a team and a team to an organization, and neither link is
 * reassignable — so an unreachable Redis has to degrade to the database rather
 * than stop a billable event from being counted.
 */
export class RedisBillingTenantOrganizationCacheAdapter implements BillingTenantOrganizationCache {
  static create(options: {
    redis: BillingTenantOrganizationCacheRedis;
  }): RedisBillingTenantOrganizationCacheAdapter {
    return new RedisBillingTenantOrganizationCacheAdapter(options.redis);
  }

  private constructor(private readonly redis: BillingTenantOrganizationCacheRedis) {}

  async get(tenantId: string): Promise<string | undefined> {
    try {
      const stored = await this.redis.get(`${BILLING_TENANT_ORGANIZATION_CACHE_PREFIX}${tenantId}`);
      if (stored === null) return undefined;
      const parsed: unknown = JSON.parse(stored);
      return typeof parsed === "string" && parsed !== "" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async set(tenantId: string, organizationId: string): Promise<void> {
    try {
      await this.redis.setex(
        `${BILLING_TENANT_ORGANIZATION_CACHE_PREFIX}${tenantId}`,
        Math.ceil(BILLING_TENANT_ORGANIZATION_CACHE_TTL_MS / 1000),
        JSON.stringify(organizationId),
      );
    } catch {
      // The database already answered; a cache that cannot remember is not a
      // reason to drop a billable event.
    }
  }
}
