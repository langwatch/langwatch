import type { Plan } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";
import { EntitlementService } from "../index";

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

describe("EntitlementService", () => {
  /** @scenario A valid license has precedence */
  it("selects a paid license without consulting subscriptions", async () => {
    const subscription = vi.fn(async () => paid("GROWTH"));
    const service = EntitlementService.create({
      baseline: free,
      license: { resolve: async () => paid("ENTERPRISE") },
      subscription: { resolve: subscription },
    });

    await expect(service.getActivePlan({ organizationId: "org" })).resolves.toMatchObject({
      type: "ENTERPRISE",
      planSource: "license",
    });
    expect(subscription).not.toHaveBeenCalled();
  });

  /** @scenario A subscription is used when no paid license exists */
  it("falls through a free license result to a paid subscription", async () => {
    const user = { id: "user", impersonator: { email: "operator@example.com" } };
    const subscription = vi.fn(async () => paid("GROWTH"));
    const service = EntitlementService.create({
      baseline: free,
      license: { resolve: async () => free },
      subscription: { resolve: subscription },
    });

    await expect(service.getActivePlan({ organizationId: "org", user })).resolves.toMatchObject({
      type: "GROWTH",
      planSource: "subscription",
    });
    expect(subscription).toHaveBeenCalledWith({ organizationId: "org", user });
  });

  /** @scenario The core baseline works without enterprise sources */
  it("uses the baseline when no enterprise source is installed", async () => {
    const service = EntitlementService.create({ baseline: free });
    await expect(service.getActivePlan({ organizationId: "org" })).resolves.toEqual(free);
  });

  /** @scenario Operator context is applied after plan selection */
  it("applies enrichment and authorization after source selection", async () => {
    const administratorEmails = new Set(["operator@example.com"]);
    const service = EntitlementService.create({
      baseline: free,
      license: { resolve: async () => paid("ENTERPRISE") },
      enrichers: [
        {
          enrich: (plan) => ({ ...plan, webhookEndpointsEnabled: true }),
        },
      ],
      authorization: {
        resolve: (user) => ({
          overrideAddingLimitations:
            !!user?.impersonator?.email && administratorEmails.has(user.impersonator.email),
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
    await expect(
      service.getActivePlan({
        organizationId: "org",
        user: { impersonator: { email: "untrusted@example.com" } },
      }),
    ).resolves.toMatchObject({
      planSource: "license",
      overrideAddingLimitations: false,
    });
  });
});
