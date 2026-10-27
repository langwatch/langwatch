// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a subscription change tells Customer.io, and a started one tells PostHog.
 * @see specs/features/customer-io-nurturing-integration.feature
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
  describe("when a subscription becomes active", () => {
    /** @scenario A started subscription tracks subscription_started for every organization member */
    it("decides one subscription_started per member with the plan and the organization", () => {
      const properties = {
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        organization_id: "org-123",
        $groups: { organization: "org-123" },
      };

      expect(
        fireSubscriptionStarted({
          organizationId: "org-123",
          memberUserIds: ["user-1", "user-2"],
          plan: "GROWTH_SEAT_EUR_MONTHLY",
        }),
      ).toEqual([
        { userId: "user-1", event: "subscription_started", properties },
        { userId: "user-2", event: "subscription_started", properties },
      ]);
    });
  });
});
