// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a subscription change tells Customer.io, and a started one tells PostHog.
 * @see specs/features/customer-io-nurturing-integration.feature
 * @see specs/analytics/posthog-campaign-conversion.feature
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import {
  customerIoPlanOf,
  fireSubscriptionStarted,
  fireSubscriptionSync,
  type NurturingOrganizationAdmin,
} from "../nurturing-subscription-sync-service.rules.ts";

const admin: NurturingOrganizationAdmin = { kind: "admin", userId: "admin-1" };

const change = {
  organizationId: "org-1",
  memberUserIds: ["user-1", "user-2"],
  hasSubscription: true,
  admin,
  skippedMemberUserIds: [],
};

describe("fireSubscriptionSync", () => {
  describe("when the change names a plan", () => {
    it("decides the group call to the admin first, then the members in one request", () => {
      const traits = { has_subscription: true, plan: "launch" };

      expect(fireSubscriptionSync({ ...change, plan: "LAUNCH" })).toEqual([
        [{ type: "group", userId: "admin-1", groupId: "org-1", traits: { plan: "launch" } }],
        [
          { type: "identify", userId: "user-1", traits },
          { type: "identify", userId: "user-2", traits },
        ],
      ]);
    });

    it("sends the company call to the first member when nurturing knows no admin", () => {
      const [group] = fireSubscriptionSync({ ...change, plan: "LAUNCH", admin: { kind: "none" } });

      expect(group).toEqual([expect.objectContaining({ type: "group", userId: "user-1" })]);
    });
  });

  describe("when a member is current in another organization", () => {
    /** @scenario "A member current in another organization is not told this plan" */
    it("does not identify that member, and still groups the admin", () => {
      const requests = fireSubscriptionSync({
        ...change,
        plan: "LAUNCH",
        skippedMemberUserIds: ["user-2"],
      });

      expect(requests.flat().map(({ type, userId }) => [type, userId])).toEqual([
        ["group", "admin-1"],
        ["identify", "user-1"],
      ]);
    });
  });

  describe("when the organization has no active member", () => {
    it("decides nothing, not even the company call", () => {
      expect(fireSubscriptionSync({ ...change, memberUserIds: [], plan: "LAUNCH" })).toEqual([]);
    });
  });

  describe("when a fact stored before it carried a plan is delivered", () => {
    /** @scenario "A subscription_changed fact stored before it carried a plan sends no plan" */
    it("identifies the members with has_subscription only and sends no group call", () => {
      expect(fireSubscriptionSync(change)).toEqual([
        [
          { type: "identify", userId: "user-1", traits: { has_subscription: true } },
          { type: "identify", userId: "user-2", traits: { has_subscription: true } },
        ],
      ]);
    });
  });

  describe("when an organization has 250 active members", () => {
    /** @scenario "No request carries more than a hundred members" */
    it("sends the identifies in requests of at most 100", () => {
      const memberUserIds = Array.from({ length: 250 }, (_, index) => `user-${index}`);

      const requests = fireSubscriptionSync({ ...change, memberUserIds, plan: "LAUNCH" });

      expect(requests.map((request) => request.length)).toEqual([1, 100, 100, 50]);
      expect(requests.flat().filter((call) => call.type === "identify")).toHaveLength(250);
    });
  });
});

describe("customerIoPlanOf", () => {
  it("lower-cases billing's plan type, as sign-up's free already is", () => {
    expect(customerIoPlanOf("GROWTH_SEAT_EUR_MONTHLY")).toBe("growth_seat_eur_monthly");
    expect(customerIoPlanOf("FREE")).toBe("free");
  });
});

describe("fireSubscriptionStarted", () => {
  describe("when a subscription becomes active", () => {
    /**
     * @scenario A started subscription tracks subscription_started for every organization member
     * @scenario "PostHog's subscription_started is unchanged"
     */
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
