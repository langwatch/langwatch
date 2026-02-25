import { describe, expect, it } from "vitest";
import {
  NullSubscriptionService,
  type SubscriptionService,
} from "../subscription.service";
import {
  NullSubscriptionRepository,
  type SubscriptionRepository,
} from "../subscription.repository";
import { SubscriptionServiceUnavailableError } from "../errors";
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
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          service.updateSubscriptionItems({
            organizationId: "org_123",
            plan: "LAUNCH",
            upgradeMembers: true,
            upgradeTraces: true,
            totalMembers: 5,
            totalTraces: 30_000,
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("createOrUpdateSubscription()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          service.createOrUpdateSubscription({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            plan: "LAUNCH",
            customerId: "cus_123",
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("createBillingPortalSession()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          service.createBillingPortalSession({
            customerId: "cus_123",
            baseUrl: "https://app.test",
            organizationId: "org_123",
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("previewProration()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          service.previewProration({
            organizationId: "org_123",
            newTotalSeats: 5,
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("createSubscriptionWithInvites()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          service.createSubscriptionWithInvites({
            organizationId: "org_123",
            baseUrl: "https://app.test",
            membersToAdd: 3,
            customerId: "cus_123",
            invites: [{ email: "user@example.com", role: "MEMBER" }],
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
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
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          repository.createPending({
            organizationId: "org_123",
            plan: "LAUNCH",
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("updateStatus()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          repository.updateStatus({
            id: "sub_123",
            status: "ACTIVE",
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });

  describe("updatePlan()", () => {
    describe("when called in self-hosted mode", () => {
      it("throws SubscriptionServiceUnavailableError", async () => {
        await expect(
          repository.updatePlan({
            id: "sub_123",
            plan: "LAUNCH",
          }),
        ).rejects.toThrow(SubscriptionServiceUnavailableError);
      });
    });
  });
});
