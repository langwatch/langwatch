import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaSubscriptionRepository } from "../services/subscription.repository";
import { NUMERIC_OVERRIDE_FIELDS } from "../planProvider";
import { SubscriptionStatus } from "../planTypes";

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
});
