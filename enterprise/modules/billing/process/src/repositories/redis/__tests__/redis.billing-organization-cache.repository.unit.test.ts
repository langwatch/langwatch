// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";

import type { BillingReportOrganizationLookup } from "../../billing-report-organization.repository.ts";
import {
  RedisBillingOrganizationCacheRepository,
  type BillingOrganizationCacheRedis,
} from "../redis.billing-organization-cache.repository.ts";

/** The whole verdict is what the cache stores, not just the organization. */
const ORGANIZATION: BillingReportOrganizationLookup = {
  outcome: "usage_billed",
  organization: {
    id: "organization_acme",
    stripeCustomerId: "cus_1",
    subscriptions: [{ id: "sub_1" }],
    contract: "cloud",
    growthSeatPeriods: [{ startMs: Date.parse("2026-02-10T13:00:00.000Z"), endMs: null }],
  },
};

/** An entry the previous release stored: no subscription periods, under the unversioned key. */
const PREVIOUS_RELEASE_ENTRY = {
  outcome: "usage_billed",
  organization: {
    id: "organization_acme",
    stripeCustomerId: "cus_1",
    subscriptions: [{ id: "sub_1" }],
    contract: "cloud",
  },
};

function cacheOver(redis: Partial<BillingOrganizationCacheRedis>) {
  return RedisBillingOrganizationCacheRepository.create({
    redis: redis as BillingOrganizationCacheRedis,
  });
}

describe("RedisBillingOrganizationCacheRepository", () => {
  describe("given the keyspace the App's own cache writes", () => {
    /**
     * The prefix and lifetime are LITERAL here rather than imported: a drifted key leaves each
     * pod reading a cache the others never write. The prefix's version moves whenever the cached
     * shape changes, so an entry an older release stored is never read as the new shape.
     */
    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("writes the key and lifetime the App writes", async () => {
      const setex = vi.fn(async () => "OK" as const);

      await cacheOver({ setex }).set("organization_acme", ORGANIZATION);

      expect(setex).toHaveBeenCalledWith(
        "ttlcache:billing:orgData:v2:organization_acme",
        60,
        JSON.stringify(ORGANIZATION),
      );
    });

    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("reads back what the other graph stored", async () => {
      const get = vi.fn(async () => JSON.stringify(ORGANIZATION));

      expect(await cacheOver({ get }).find("organization_acme")).toEqual(ORGANIZATION);
      expect(get).toHaveBeenCalledWith("ttlcache:billing:orgData:v2:organization_acme");
    });

    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("never reads an entry the previous release stored without subscription periods", async () => {
      const entries = new Map([
        ["ttlcache:billing:orgData:organization_acme", JSON.stringify(PREVIOUS_RELEASE_ENTRY)],
      ]);
      const get = vi.fn(async (key: string) => entries.get(key) ?? null);

      expect(await cacheOver({ get }).find("organization_acme")).toBeUndefined();
    });

    /** @scenario "Both graphs cache the billing organization read in one keyspace" */
    it("reports a miss as a miss rather than as a null organization", async () => {
      expect(
        await cacheOver({ get: vi.fn(async () => null) }).find("organization_acme"),
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

      expect(await cacheOver(failing).find("organization_acme")).toBeUndefined();
      await expect(
        cacheOver(failing).set("organization_acme", ORGANIZATION),
      ).resolves.toBeUndefined();
    });
  });
});
