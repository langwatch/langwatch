import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EntitlementApi, type Plan } from "@langwatch/entitlement-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { REQUEST_BOUND_KEYS, requestBounds } from "@langwatch/plans";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { createAbsentRequestBound, entitlementServer } from "../../entitlement.server.ts";
import {
  createEntitlementTestApp,
  createEntitlementTestUsers,
  fixedEntitlementSource,
} from "./entitlement.fixture.ts";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

const paid = (type: string): Plan => ({
  ...free,
  planSource: "subscription",
  type,
  name: type,
  free: false,
});

const enterprise: Plan = paid("ENTERPRISE");

/** Self-hosted baseline: OPEN_SOURCE resolves to the enterprise bounds. */
const openSource: Plan = { ...free, type: "OPEN_SOURCE", name: "Open Source" };

function appForLicense(plan: Plan | null) {
  return createEntitlementTestApp({
    members: { baseline: free, license: fixedEntitlementSource(plan) },
  });
}

describe("EntitlementApp.requestBound", () => {
  it("resolves the free tier for an organization on the free baseline", async () => {
    const app = appForLicense(null);

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(1_000);
    // Tier-agnostic bounds answer the same number on every tier.
    await expect(
      app.requestBound({ key: "bodyLimitJsonBytes", organizationId: "organization-1" }),
    ).resolves.toBe(1_048_576);
  });

  it("resolves the paid tier when a paid plan resolves", async () => {
    const app = appForLicense(paid("PRO"));

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(2_000);
  });

  it("resolves the enterprise tier when the license grants ENTERPRISE", async () => {
    const app = appForLicense(enterprise);

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(4_000);
  });

  it("resolves the enterprise tier for a self-hosted OPEN_SOURCE baseline", async () => {
    const app = createEntitlementTestApp({
      members: { baseline: openSource, license: fixedEntitlementSource(null) },
    });

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(4_000);
  });

  it("lets a plain-number override win on every tier without a plan lookup", async () => {
    const app = createEntitlementTestApp({
      members: { baseline: free, license: fixedEntitlementSource(enterprise) },
      config: { requestBounds: { tracesPageSizeMax: 42 } },
    });

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(42);
    await expect(
      app.requestBound({ key: "traceIdsMax", organizationId: "organization-1" }),
    ).resolves.toBe(4_000);
  });

  it("lets a per-tier override win only on the plan's own tier", async () => {
    const app = createEntitlementTestApp({
      members: { baseline: free, license: fixedEntitlementSource(paid("PRO")) },
      config: { requestBounds: { tracesPageSizeMax: { paid: 3_000, enterprise: 6_000 } } },
    });

    await expect(
      app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(3_000);

    const enterpriseApp = createEntitlementTestApp({
      members: { baseline: free, license: fixedEntitlementSource(enterprise) },
      config: { requestBounds: { tracesPageSizeMax: { paid: 3_000, enterprise: 6_000 } } },
    });

    await expect(
      enterpriseApp.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
    ).resolves.toBe(6_000);
  });

  it("falls back to the registry value for tiers a partial override does not name", async () => {
    const app = createEntitlementTestApp({
      members: { baseline: free, license: fixedEntitlementSource(null) },
      config: { requestBounds: { exportPerMinute: { paid: 24 } } },
    });

    await expect(
      app.requestBound({ key: "exportPerMinute", organizationId: "organization-1" }),
    ).resolves.toBe(6);
  });

  /**
   * The whole boot path a process actually runs: the module's config slice
   * carries the overrides record through the module schema into the service.
   */
  it("receives per-tier overrides through the installed module's config slice", async () => {
    const { logger } = createTestLogger();
    const runtime = await createApp({ role: "api" })
      .withModules([withMemoryRepositories(entitlementServer)])
      .withConfig({
        entitlement: {
          // The unlicensed cloud baseline resolves FREE, so the override must
          // name the free tier to be observed — exercising the module schema's
          // tier-record arm end to end.
          requestBounds: { tracesPageSizeMax: { free: 3_000 } },
        },
      })
      .withMembers({ isSaas: true, processName: "test" })
      .withObservability((observability) => observability.withLogging(logger))
      .provide({
        user: createEntitlementTestUsers(),
        licensing: createApiFixture<LicensingApi>({
          resolve: async () => free,
        }),
      })
      .boot();

    try {
      const app = runtime.service(EntitlementApi);

      await expect(
        app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-1" }),
      ).resolves.toBe(3_000);
    } finally {
      await runtime.stop();
    }
  });
});

describe("createAbsentRequestBound", () => {
  it("answers the free-tier value for every bound", async () => {
    const bounds = createAbsentRequestBound();

    for (const bound of requestBounds) {
      await expect(
        bounds.requestBound({ key: bound.key, organizationId: "organization-1" }),
      ).resolves.toBe(bound.free);
    }
    expect(REQUEST_BOUND_KEYS.length).toBeGreaterThan(0);
  });

  it("refuses loudly on a key the registry does not carry", async () => {
    const bounds = createAbsentRequestBound();

    await expect(
      bounds.requestBound({ key: "no-such-bound" as never, organizationId: "organization-1" }),
    ).rejects.toThrow(/Unknown request bound/);
  });
});
