// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a subscription change tells Customer.io and PostHog.
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireSubscriptionStarted,
  fireSubscriptionSync,
} from "../nurturing-subscription-sync-service.rules.ts";

describe("fireSubscriptionSync", () => {
  it("decides one has_subscription identify per member", () => {
    expect(
      fireSubscriptionSync({ memberUserIds: ["user-1", "user-2"], hasSubscription: true }),
    ).toEqual([
      { type: "identify", userId: "user-1", traits: { has_subscription: true } },
      { type: "identify", userId: "user-2", traits: { has_subscription: true } },
    ]);
  });
});

describe("fireSubscriptionStarted", () => {
  describe("given a subscription that just became active", () => {
    /** @scenario A started subscription tracks subscription_started for every organization member */
    it("decides one subscription_started per member with the plan and the organization", () => {
      const events = fireSubscriptionStarted({
        organizationId: "org-1",
        memberUserIds: ["user-1", "user-2"],
        startedPlan: "GROWTH_SEAT_EVENT",
      });

      const properties = {
        plan: "GROWTH_SEAT_EVENT",
        organization_id: "org-1",
        $groups: { organization: "org-1" },
      };
      expect(events).toEqual([
        { userId: "user-1", event: "subscription_started", properties },
        { userId: "user-2", event: "subscription_started", properties },
      ]);
    });
  });

  describe("given a subscription change that started nothing", () => {
    /** @scenario A subscription change that starts nothing tracks no subscription_started */
    it("decides nothing for a cancellation or a change that names no started plan", () => {
      expect(
        fireSubscriptionStarted({ organizationId: "org-1", memberUserIds: ["user-1"] }),
      ).toEqual([]);
      expect(
        fireSubscriptionStarted({
          organizationId: "org-1",
          memberUserIds: ["user-1"],
          startedPlan: null,
        }),
      ).toEqual([]);
    });
  });
});
