import type { Plan } from "@langwatch/entitlements-contract";
import { describe, expect, it, vi } from "vitest";
import { EntitlementsService } from "../src";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

const paid = (type: string): Plan => ({
  ...free,
  planSource: "subscription",
  type,
  name: type,
  free: false,
});

describe("EntitlementsService", () => {
  /** @scenario A valid license has precedence */
  it("selects a paid license without consulting subscriptions", async () => {
    const subscription = vi.fn(async () => paid("GROWTH"));
    const service = EntitlementsService.create({
      baseline: free,
      license: { resolve: async () => paid("ENTERPRISE") },
      subscription: { resolve: subscription },
    });

    await expect(
      service.getActivePlan({ organizationId: "org" }),
    ).resolves.toMatchObject({
      type: "ENTERPRISE",
      planSource: "license",
    });
    expect(subscription).not.toHaveBeenCalled();
  });

  /** @scenario A subscription is used when no paid license exists */
  it("falls through a free license result to a paid subscription", async () => {
    const service = EntitlementsService.create({
      baseline: free,
      license: { resolve: async () => free },
      subscription: { resolve: async () => paid("GROWTH") },
    });

    await expect(
      service.getActivePlan({ organizationId: "org" }),
    ).resolves.toMatchObject({
      type: "GROWTH",
      planSource: "subscription",
    });
  });

  /** @scenario The core baseline works without enterprise sources */
  it("uses the baseline when no enterprise source is installed", async () => {
    const service = EntitlementsService.create({ baseline: free });
    await expect(
      service.getActivePlan({ organizationId: "org" }),
    ).resolves.toEqual(free);
  });

  /** @scenario Operator context is applied after plan selection */
  it("applies enrichment and authorization after source selection", async () => {
    const service = EntitlementsService.create({
      baseline: free,
      license: { resolve: async () => paid("ENTERPRISE") },
      enrichers: [
        {
          enrich: (plan) => ({ ...plan, webhookEndpointsEnabled: true }),
        },
      ],
      authorization: {
        resolve: (user) => ({
          overrideAddingLimitations: Boolean(user?.impersonator),
        }),
      },
    });

    await expect(
      service.getActivePlan({
        organizationId: "org",
        user: { impersonator: { email: "operator@example.com" } },
      }),
    ).resolves.toMatchObject({
      planSource: "license",
      webhookEndpointsEnabled: true,
      overrideAddingLimitations: true,
    });
  });
});
