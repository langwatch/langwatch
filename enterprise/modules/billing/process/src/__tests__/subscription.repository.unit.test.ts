import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaBillingSubscription } from "../repositories/prisma/prisma.subscription.repository.ts";
import { NUMERIC_OVERRIDE_FIELDS } from "../services/plan-provider.service.ts";

describe("PrismaBillingSubscription", () => {
  let prisma: { subscription: { update: ReturnType<typeof vi.fn> } };
  let repo: PrismaBillingSubscription;

  beforeEach(() => {
    prisma = {
      subscription: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    repo = PrismaBillingSubscription.create(prisma as unknown as PrismaClient);
  });

  describe("cancel()", () => {
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
