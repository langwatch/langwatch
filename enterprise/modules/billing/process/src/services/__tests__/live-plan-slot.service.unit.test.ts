// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Billing answers whether another module's subscription write would start a second live plan.
 * @see ../../../../specs/billing.feature
 */
import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { LivePlanSlotService } from "../live-plan-slot.service.ts";

const ORG = "org_acme";

const row = (fields: Partial<BillingSubscriptionRecord>): BillingSubscriptionRecord => ({
  id: "sub_db",
  organizationId: ORG,
  status: SubscriptionStatus.PENDING,
  plan: "GROWTH_SEAT_EUR_MONTHLY",
  stripeSubscriptionId: null,
  createdAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
  startDate: null,
  endDate: null,
  maxMembers: 3,
  maxMembersLite: null,
  maxMembersDeveloper: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
  seatsKept: null,
  seatsKeptUntil: null,
  ...fields,
});

function livePlans() {
  const store = MemoryBillingStore.create();
  store.subscriptions.push(
    row({ id: "sub_seat", status: SubscriptionStatus.ACTIVE, stripeSubscriptionId: "s_seat" }),
    row({
      id: "sub_tiered",
      status: SubscriptionStatus.ACTIVE,
      plan: "LAUNCH",
      stripeSubscriptionId: "s_tiered",
    }),
    row({ id: "sub_pending", stripeSubscriptionId: "s_pending" }),
    row({ id: "sub_unlinked", status: SubscriptionStatus.CANCELLED, plan: "ENTERPRISE" }),
  );
  return LivePlanSlotService.create({
    subscriptions: MemoryBillingSubscriptionRepository.create(store),
  });
}

const refusal = {
  code: "subscription_already_active",
  meta: { organizationId: ORG, liveSubscriptionIds: ["sub_seat"] },
};

describe("given an organization with a live seat plan beside the tiered plan it replaces", () => {
  describe("when a write would activate, create, link or move in a second linked plan", () => {
    /** @scenario "Billing refuses another module's write that would start a second live plan" */
    it.each([
      { id: "sub_pending", status: "ACTIVE" },
      {
        organizationId: ORG,
        status: "ACTIVE",
        plan: "ENTERPRISE",
        stripeSubscriptionId: "s_new",
      },
      { id: "sub_unlinked", status: "ACTIVE", stripeSubscriptionId: "s_linked" },
      { id: "sub_tiered", plan: "GROWTH_SEAT_EUR_MONTHLY" },
    ])("refuses %o naming the live seat plan", async (write) => {
      await expect(livePlans().assertWriteAllowed({ writes: [write] })).rejects.toMatchObject(
        refusal,
      );
    });

    /** @scenario "Billing refuses another module's write that would start a second live plan" */
    it("refuses two linked plans activated in one bulk write", async () => {
      const store = MemoryBillingStore.create();
      store.subscriptions.push(
        row({ id: "sub_a", stripeSubscriptionId: "s_a" }),
        row({ id: "sub_b", stripeSubscriptionId: "s_b" }),
      );
      const service = LivePlanSlotService.create({
        subscriptions: MemoryBillingSubscriptionRepository.create(store),
      });

      await expect(
        service.assertWriteAllowed({
          writes: [
            { id: "sub_a", status: "ACTIVE" },
            { id: "sub_b", status: "ACTIVE" },
          ],
        }),
      ).rejects.toMatchObject({
        code: "subscription_already_active",
        meta: { organizationId: ORG, liveSubscriptionIds: [] },
      });
    });
  });

  describe("when a write edits the tiered plan, the live plan itself or an unlinked row", () => {
    /** @scenario "Billing refuses another module's write that would start a second live plan" */
    it.each([
      { id: "sub_tiered", status: "ACTIVE", maxMembers: 9 },
      { id: "sub_seat", status: "ACTIVE" },
      { id: "sub_unlinked", status: "ACTIVE" },
      { organizationId: ORG, status: "ACTIVE", plan: "ENTERPRISE" },
      { id: "sub_missing", status: "ACTIVE", stripeSubscriptionId: "s_missing" },
    ])("allows %o", async (write) => {
      await expect(livePlans().assertWriteAllowed({ writes: [write] })).resolves.toBeUndefined();
    });
  });
});
