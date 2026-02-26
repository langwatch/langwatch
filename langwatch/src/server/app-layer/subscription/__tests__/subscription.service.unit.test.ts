import { describe, expect, it } from "vitest";
import {
  NullSubscriptionService,
  type SubscriptionService,
} from "../subscription.service";
import {
  NullSubscriptionRepository,
  type SubscriptionRepository,
} from "../subscription.repository";
import type { EESubscriptionService } from "../../../../../ee/billing/services/subscription.service";

// --------------------------------------------------------------------------
// Type-level conformance checks (compile-time only, no runtime cost)
// --------------------------------------------------------------------------
type Assert<T extends true> = T;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertEEConforms = Assert<
  EESubscriptionService extends SubscriptionService ? true : false
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertNullServiceConforms = Assert<
  NullSubscriptionService extends SubscriptionService ? true : false
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertNullRepoConforms = Assert<
  NullSubscriptionRepository extends SubscriptionRepository ? true : false
>;

describe("NullSubscriptionService", () => {
  const service = new NullSubscriptionService();

  describe("getLastNonCancelledSubscription()", () => {
    describe("when querying for any organization", () => {
      it("returns null", async () => {
        const result =
          await service.getLastNonCancelledSubscription("org_123");

        expect(result).toBeNull();
      });
    });
  });

  describe("notifyProspective()", () => {
    describe("when called with any parameters", () => {
      it("returns success false", async () => {
        const result = await service.notifyProspective({
          organizationId: "org_123",
          plan: "LAUNCH",
          actorEmail: "actor@example.com",
        });

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe("updateSubscriptionItems()", () => {
    describe("when called in self-hosted mode", () => {
      it("returns success false", async () => {
        const result = await service.updateSubscriptionItems({
          organizationId: "org_123",
          plan: "LAUNCH",
          upgradeMembers: true,
          upgradeTraces: true,
          totalMembers: 5,
          totalTraces: 30_000,
        });

        expect(result).toEqual({ success: false });
      });
    });
  });

  describe("createOrUpdateSubscription()", () => {
    describe("when called in self-hosted mode", () => {
      it("returns null url", async () => {
        const result = await service.createOrUpdateSubscription({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          plan: "LAUNCH",
          customerId: "cus_123",
        });

        expect(result).toEqual({ url: null });
      });
    });
  });

  describe("createBillingPortalSession()", () => {
    describe("when called in self-hosted mode", () => {
      it("returns empty url", async () => {
        const result = await service.createBillingPortalSession({
          customerId: "cus_123",
          baseUrl: "https://app.test",
          organizationId: "org_123",
        });

        expect(result).toEqual({ url: "" });
      });
    });
  });

  describe("previewProration()", () => {
    describe("when called in self-hosted mode", () => {
      it("returns empty strings", async () => {
        const result = await service.previewProration({
          organizationId: "org_123",
          newTotalSeats: 5,
        });

        expect(result).toEqual({
          formattedAmountDue: "",
          formattedRecurringTotal: "",
          billingInterval: "",
        });
      });
    });
  });

  describe("createSubscriptionWithInvites()", () => {
    describe("when called in self-hosted mode", () => {
      it("returns null url", async () => {
        const result = await service.createSubscriptionWithInvites({
          organizationId: "org_123",
          baseUrl: "https://app.test",
          membersToAdd: 3,
          customerId: "cus_123",
          invites: [{ email: "user@example.com", role: "MEMBER" }],
        });

        expect(result).toEqual({ url: null });
      });
    });
  });
});

describe("NullSubscriptionRepository", () => {
  const repository = new NullSubscriptionRepository();

  describe("findLastNonCancelled()", () => {
    describe("when querying for any organization", () => {
      it("returns null", async () => {
        const result = await repository.findLastNonCancelled("org_123");

        expect(result).toBeNull();
      });
    });
  });

  describe("createPending()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.createPending({
            organizationId: "org_123",
            plan: "LAUNCH",
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("updateStatus()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.updateStatus({
            id: "sub_123",
            status: "ACTIVE",
          }),
        ).resolves.not.toThrow();
      });
    });
  });

  describe("updatePlan()", () => {
    describe("when called in self-hosted mode", () => {
      it("resolves without throwing", async () => {
        await expect(
          repository.updatePlan({
            id: "sub_123",
            plan: "LAUNCH",
          }),
        ).resolves.not.toThrow();
      });
    });
  });
});
