// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a started subscription reports to PostHog, and to whom.
 *
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import { describe, expect, it, vi } from "vitest";

import { BillingProductAnalyticsChannel } from "../../channels/billing-product-analytics.channel.ts";
import { MemoryBillingProductAnalyticsChannel } from "../../channels/memory/memory.billing-product-analytics.channel.ts";
import { BillingSubscriptionStartedAnalyticsService } from "../billing-subscription-started-analytics.service.ts";

function reporter() {
  const captured: { error: Error; context?: Record<string, unknown> }[] = [];

  return {
    captured,
    errors: {
      capture: (error: Error, context?: Record<string, unknown>) => {
        captured.push({ error, context });
      },
    },
  };
}

const twoMembers = async () => [{ id: "user-1" }, { id: "user-2" }];

describe("BillingSubscriptionStartedAnalyticsService", () => {
  describe("when a subscription becomes active", () => {
    /** @scenario A started subscription tracks subscription_started for every organization member */
    it("tracks subscription_started for each organization member", async () => {
      const analytics = MemoryBillingProductAnalyticsChannel.create();
      const getAllMembers = vi.fn(twoMembers);
      const service = BillingSubscriptionStartedAnalyticsService.create({
        analytics,
        organizations: { getAllMembers },
        errors: reporter().errors,
      });

      service.fire({ organizationId: "org-123", plan: "GROWTH_SEAT_EUR_MONTHLY" });

      await vi.waitFor(() => expect(analytics.tracked).toHaveLength(2));
      expect(getAllMembers).toHaveBeenCalledWith({ organizationId: "org-123" });
      const properties = {
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        organization_id: "org-123",
        $groups: { organization: "org-123" },
      };
      expect(analytics.tracked).toEqual([
        { userId: "user-1", event: "subscription_started", properties },
        { userId: "user-2", event: "subscription_started", properties },
      ]);
    });
  });

  describe("when PostHog is not configured", () => {
    /** @scenario subscription_started is skipped when PostHog is not configured */
    it("does not query members or track", async () => {
      const getAllMembers = vi.fn(twoMembers);
      const { errors, captured } = reporter();
      const service = BillingSubscriptionStartedAnalyticsService.create({
        analytics: undefined,
        organizations: { getAllMembers },
        errors,
      });

      service.fire({ organizationId: "org-123", plan: "LAUNCH" });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getAllMembers).not.toHaveBeenCalled();
      expect(captured).toEqual([]);
    });
  });

  describe("when the member lookup fails", () => {
    /** @scenario A failed member lookup does not break the webhook */
    it("captures the error and does not throw", async () => {
      const analytics = MemoryBillingProductAnalyticsChannel.create();
      const { errors, captured } = reporter();
      const error = new Error("db unavailable");
      const service = BillingSubscriptionStartedAnalyticsService.create({
        analytics,
        organizations: {
          getAllMembers: async () => {
            throw error;
          },
        },
        errors,
      });

      expect(() => service.fire({ organizationId: "org-123", plan: "LAUNCH" })).not.toThrow();

      await vi.waitFor(() => expect(captured).toHaveLength(1));
      expect(captured[0]).toEqual({
        error,
        context: { handler: "subscriptionStartedAnalytics", organizationId: "org-123" },
      });
      expect(analytics.tracked).toEqual([]);
    });
  });

  describe("when the PostHog client cannot be built", () => {
    /** @scenario A PostHog client that cannot be built does not break the webhook */
    it("captures the error and does not throw", async () => {
      const error = new Error("bad PostHog configuration");
      class UnbuildableAnalyticsChannel extends BillingProductAnalyticsChannel {
        track(): void {
          throw error;
        }
      }
      const { errors, captured } = reporter();
      const service = BillingSubscriptionStartedAnalyticsService.create({
        analytics: new UnbuildableAnalyticsChannel(),
        organizations: { getAllMembers: twoMembers },
        errors,
      });

      expect(() => service.fire({ organizationId: "org-123", plan: "LAUNCH" })).not.toThrow();

      await vi.waitFor(() => expect(captured).toHaveLength(1));
      expect(captured[0]?.error).toBe(error);
    });
  });
});
