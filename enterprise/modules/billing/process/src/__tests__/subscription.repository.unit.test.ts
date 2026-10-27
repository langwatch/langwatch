import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { PrismaBillingSubscriptionRepository } from "../repositories/prisma/prisma.subscription.repository.ts";
import { NUMERIC_OVERRIDE_FIELDS } from "../services/plan-provider.service.ts";

describe("PrismaBillingSubscriptionRepository", () => {
  let update: Mock<(args: unknown) => Promise<object>>;
  let repo: PrismaBillingSubscriptionRepository;

  beforeEach(() => {
    update = vi.fn(async (_args: unknown) => ({}));
    repo = PrismaBillingSubscriptionRepository.create(prismaDouble({ subscription: { update } }));
  });

  describe("cancel()", () => {
    /** @scenario Cancelled subscription nullifies all override fields */
    it("nullifies every numeric override field when cancelling a subscription", async () => {
      await repo.cancel({ id: "sub_123" });

      expect(update).toHaveBeenCalledTimes(1);
      const call = update.mock.calls[0]?.[0] as {
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
