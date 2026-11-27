import { PlanTypes, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
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

  describe("findSupersededBySeatEvent()", () => {
    it("lists cancelled tiered rows too, flagged, and only rows Stripe holds", async () => {
      const findMany = vi.fn(async (_args: unknown) => [
        { id: "sub_live", stripeSubscriptionId: "stripe_live", status: SubscriptionStatus.ACTIVE },
        {
          id: "sub_done",
          stripeSubscriptionId: "stripe_done",
          status: SubscriptionStatus.CANCELLED,
        },
        { id: "sub_local", stripeSubscriptionId: null, status: SubscriptionStatus.ACTIVE },
      ]);
      const superseded = PrismaBillingSubscriptionRepository.create(
        prismaDouble({ subscription: { findMany } }),
      );

      const found = await superseded.findSupersededBySeatEvent({
        organizationId: "org_1",
        excludeSubscriptionId: "sub_growth",
      });

      expect(found).toEqual([
        { id: "sub_live", stripeSubscriptionId: "stripe_live", cancelledInRecords: false },
        { id: "sub_done", stripeSubscriptionId: "stripe_done", cancelledInRecords: true },
      ]);
      expect(findMany).toHaveBeenCalledTimes(1);
      const [query] = findMany.mock.calls[0] ?? [];
      const { where } = query as { where: Record<string, unknown> };
      expect(where).toEqual({
        organizationId: "org_1",
        id: { not: "sub_growth" },
        stripeSubscriptionId: { not: null },
        plan: {
          in: [
            PlanTypes.LAUNCH,
            PlanTypes.ACCELERATE,
            PlanTypes.LAUNCH_ANNUAL,
            PlanTypes.ACCELERATE_ANNUAL,
            PlanTypes.PRO,
            PlanTypes.GROWTH,
          ],
        },
      });
    });
  });
});
