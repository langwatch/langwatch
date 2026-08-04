import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NUMERIC_OVERRIDE_FIELDS } from "../planProvider";
import { SubscriptionStatus } from "../planTypes";
import { PrismaSubscriptionRepository } from "../services/subscription.repository";

describe("PrismaSubscriptionRepository", () => {
  let prisma: { subscription: { update: ReturnType<typeof vi.fn> } };
  let repo: PrismaSubscriptionRepository;

  beforeEach(() => {
    prisma = {
      subscription: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    repo = new PrismaSubscriptionRepository(prisma as unknown as PrismaClient);
  });

  describe("cancel", () => {
    /** @scenario Cancelled subscription nullifies all override fields */
    it("nullifies every numeric override field when cancelling a subscription", async () => {
      await repo.cancel({ id: "sub_123" });

      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      const call = prisma.subscription.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };

      expect(call.where).toEqual({ id: "sub_123" });
      expect(call.data.status).toBe(SubscriptionStatus.CANCELLED);
      expect(call.data.endDate).toBeInstanceOf(Date);

      for (const field of NUMERIC_OVERRIDE_FIELDS) {
        expect(call.data[field]).toBeNull();
      }
    });
  });

  describe("when activating a subscription", () => {
    /** @scenario Reactivation clears stale endDate left by a prior cancellation */
    it("clears endDate when reactivating a subscription", async () => {
      await repo.activate({ id: "sub_456", previousStatus: SubscriptionStatus.CANCELLED });

      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      const call = prisma.subscription.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };

      expect(call.where).toEqual({ id: "sub_456" });
      expect(call.data.status).toBe(SubscriptionStatus.ACTIVE);
      expect(call.data.endDate).toBeNull();
      expect(call.data.lastPaymentFailedDate).toBeNull();
    });

    /** @scenario Updating an already active subscription preserves its original start date */
    it("clears endDate without resetting startDate for an active subscription", async () => {
      await repo.activate({ id: "sub_789", previousStatus: SubscriptionStatus.ACTIVE });

      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      const call = prisma.subscription.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };

      expect(call.where).toEqual({ id: "sub_789" });
      expect(call.data.status).toBe(SubscriptionStatus.ACTIVE);
      expect(call.data.endDate).toBeNull();
      expect(call.data).not.toHaveProperty("startDate");
    });
  });

  describe("when updating subscription quantities", () => {
    /** @scenario Quantity update clears stale endDate left by a prior cancellation */
    it("clears endDate when updating subscription quantities", async () => {
      await repo.updateQuantities({
        id: "sub_789",
        maxMembers: 10,
        maxMessagesPerMonth: 5000,
      });

      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
      const call = prisma.subscription.update.mock.calls[0]?.[0] as {
        where: { id: string };
        data: Record<string, unknown>;
      };

      expect(call.where).toEqual({ id: "sub_789" });
      expect(call.data.status).toBe(SubscriptionStatus.ACTIVE);
      expect(call.data.endDate).toBeNull();
      expect(call.data.maxMembers).toBe(10);
      expect(call.data.maxMessagesPerMonth).toBe(5000);
    });
  });
});
