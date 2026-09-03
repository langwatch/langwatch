// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import {
  RedisBillingOrganizationCacheAdapter,
  type BillingOrganizationCacheRedis,
} from "../redis.billing-organization-cache.adapter";
import type { BillingReportOrganizationLookup } from "../../ports/billing-report-organization.port";

/** The whole verdict is what the cache stores, not just the organization. */
const ORGANIZATION: BillingReportOrganizationLookup = {
  outcome: "usage_billed",
  organization: {
    id: "organization_acme",
    stripeCustomerId: "cus_1",
    subscriptions: [{ id: "sub_1" }],
  },
};

function cacheOver(redis: Partial<BillingOrganizationCacheRedis>) {
  return RedisBillingOrganizationCacheAdapter.create({
    redis: redis as BillingOrganizationCacheRedis,
  });
}

describe("RedisBillingOrganizationCacheAdapter", () => {
  describe("given the keyspace the App's own cache writes", () => {
    /**
     * Frozen twin: the App caches this read through
     * `new TtlCache<CachedOrgData>(BILLING_ORG_CACHE_TTL_MS, BILLING_ORG_CACHE_PREFIX)`
     * over the same Redis, storing `JSON.stringify(value)`. The prefix and the
     * lifetime are LITERAL here rather than imported, because a drifted key
     * leaves each graph reading a cache the other never writes — not an error,
     * just two populations paying for each other's misses.
     */
    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("writes the key and lifetime the App writes", async () => {
      const setex = vi.fn(async () => "OK" as const);

      await cacheOver({ setex }).set("organization_acme", ORGANIZATION);

      expect(setex).toHaveBeenCalledWith(
        "ttlcache:billing:orgData:organization_acme",
        60,
        JSON.stringify(ORGANIZATION),
      );
    });

    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("reads back what the other graph stored", async () => {
      const get = vi.fn(async () => JSON.stringify(ORGANIZATION));

      expect(await cacheOver({ get }).get("organization_acme")).toEqual(ORGANIZATION);
      expect(get).toHaveBeenCalledWith("ttlcache:billing:orgData:organization_acme");
    });

    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("reports a miss as a miss rather than as a null organization", async () => {
      expect(
        await cacheOver({ get: vi.fn(async () => null) }).get("organization_acme"),
      ).toBeUndefined();
    });

    /**
     * The cache spares Postgres one lookup per organization per minute. An
     * unreachable Redis has to degrade to the database rather than stop a
     * month being reported, so both halves swallow.
     */
    /** @scenario "An unreachable cache never stops a month being reported" */
    it("degrades to the database when Redis refuses", async () => {
      const failing = {
        get: vi.fn(async () => {
          throw new Error("connection refused");
        }),
        setex: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      };

      expect(await cacheOver(failing).get("organization_acme")).toBeUndefined();
      await expect(
        cacheOver(failing).set("organization_acme", ORGANIZATION),
      ).resolves.toBeUndefined();
    });
  });
});
