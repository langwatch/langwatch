// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** @see enterprise/modules/billing/specs/stripe-webhook.feature */
import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { TieredPlanRetirementService } from "../tiered-plan-retirement.service.ts";

const ORGANIZATION_ID = "org_upgrading";
const TIERED = { id: "db_tiered", stripeSubscriptionId: "sub_tiered", plan: "LAUNCH" };
const GROWTH = {
  id: "db_growth",
  stripeSubscriptionId: "sub_growth",
  plan: "GROWTH_SEAT_EUR_MONTHLY",
};
const RETIREMENT = {
  organizationId: ORGANIZATION_ID,
  seatStripeSubscriptionId: GROWTH.stripeSubscriptionId,
};

function subscriptionRow(
  row: { id: string; stripeSubscriptionId: string; plan: string },
  status: string,
): BillingSubscriptionRecord {
  return {
    ...row,
    organizationId: ORGANIZATION_ID,
    status,
    createdAt: Temporal.Now.instant(),
    startDate: Temporal.Now.instant(),
    endDate: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
    maxMembers: null,
    maxMembersLite: null,
    maxMessagesPerMonth: null,
  };
}

function setup({
  growthStatus = SubscriptionStatus.ACTIVE,
  tieredAtStripe = "active",
  recordRefusals = 0,
}: {
  growthStatus?: string;
  tieredAtStripe?: "active" | "canceled" | "incomplete_expired";
  /** Times our record of the cancellation is refused before it lands. */
  recordRefusals?: number;
} = {}) {
  const store = MemoryBillingStore.create();
  store.subscriptions.push(subscriptionRow(TIERED, SubscriptionStatus.ACTIVE));
  store.subscriptions.push(subscriptionRow(GROWTH, growthStatus));
  const repository = MemoryBillingWebhookSubscriptionRepository.create({
    subscriptions: MemoryBillingSubscriptionRepository.create(store),
    store,
  });
  let refusals = recordRefusals;
  const stripe = MemoryStripeSubscriptionsChannel.create();
  stripe.seed({
    subscription: {
      id: TIERED.stripeSubscriptionId,
      status: tieredAtStripe,
      canceledAt: null,
      billingThreshold: null,
      items: [],
    },
  });
  const pricingModels: { organizationId: string; pricingModel: string }[] = [];
  const service = TieredPlanRetirementService.create({
    subscriptions: {
      findByStripeId: (id) => repository.findByStripeId(id),
      findSupersededBySeatEvent: (input) => repository.findSupersededBySeatEvent(input),
      cancel: async (input) => {
        if (refusals > 0) {
          refusals--;
          throw new Error("cancel record refused");
        }
        await repository.cancel(input);
      },
    },
    stripeSubscriptions: stripe,
    facts: {
      pricingModelChanged: async (input) => {
        pricingModels.push(input);
      },
    },
  });
  const tieredStatus = () => store.subscriptions.find((row) => row.id === TIERED.id)?.status;
  return { service, stripe, pricingModels, tieredStatus };
}

const CANCELLED_ONCE = [{ subscriptionId: TIERED.stripeSubscriptionId, prorate: true }];

describe("TieredPlanRetirementService", () => {
  describe("when the Growth seat subscription is active beside a live tiered one", () => {
    /** @scenario "A retirement cancels the tiered subscription in Stripe and in our records" */
    it("cancels it in Stripe with proration and in our records, on seat pricing", async () => {
      const { service, stripe, pricingModels, tieredStatus } = setup();

      await service.retireTieredPlans(RETIREMENT);

      expect(stripe.cancellations).toEqual(CANCELLED_ONCE);
      expect(tieredStatus()).toBe(SubscriptionStatus.CANCELLED);
      expect(pricingModels).toEqual([
        { organizationId: ORGANIZATION_ID, pricingModel: "SEAT_EVENT" },
      ]);
    });
  });

  describe("when the record fails after Stripe cancelled", () => {
    /** @scenario "A redelivered retirement cancels in Stripe once" */
    it("records the cancellation on the retry without cancelling in Stripe again", async () => {
      const { service, stripe, tieredStatus } = setup({ recordRefusals: 1 });

      await expect(service.retireTieredPlans(RETIREMENT)).rejects.toThrow(
        "superseded tiered subscription(s) were not retired",
      );
      expect(tieredStatus()).toBe(SubscriptionStatus.ACTIVE);
      await service.retireTieredPlans(RETIREMENT);
      await service.retireTieredPlans(RETIREMENT);

      expect(tieredStatus()).toBe(SubscriptionStatus.CANCELLED);
      expect(stripe.cancellations).toEqual(CANCELLED_ONCE);
    });
  });

  describe("when the tiered subscription has already ended at Stripe", () => {
    /** @scenario "A tiered subscription Stripe already cancelled is not cancelled again" */
    it.each(["canceled", "incomplete_expired"] as const)(
      "does not ask Stripe to cancel it while it is %s and cancels it in our records",
      async (tieredAtStripe) => {
        const { service, stripe, tieredStatus } = setup({ tieredAtStripe });

        await service.retireTieredPlans(RETIREMENT);

        expect(stripe.cancellations).toEqual([]);
        expect(tieredStatus()).toBe(SubscriptionStatus.CANCELLED);
      },
    );
  });

  describe("when the Growth seat subscription is not active", () => {
    /** @scenario "A seat subscription that is not active retires nothing" */
    it.each([SubscriptionStatus.PENDING, SubscriptionStatus.CANCELLED])(
      "retires nothing while it is %s",
      async (growthStatus) => {
        const { service, stripe, pricingModels, tieredStatus } = setup({ growthStatus });

        await service.retireTieredPlans(RETIREMENT);

        expect(stripe.cancellations).toEqual([]);
        expect(tieredStatus()).toBe(SubscriptionStatus.ACTIVE);
        expect(pricingModels).toEqual([]);
      },
    );
  });

  describe("when Stripe refuses the cancellation", () => {
    /** @scenario "A Stripe failure fails the retirement so the outbox retries it" */
    it("fails, keeps the tiered row active, and a later run cancels it once", async () => {
      const { service, stripe, tieredStatus } = setup();
      stripe.refuse({
        operation: "cancelSubscription",
        error: new Error("Stripe unavailable"),
        times: 1,
      });

      await expect(service.retireTieredPlans(RETIREMENT)).rejects.toThrow(AggregateError);
      expect(tieredStatus()).toBe(SubscriptionStatus.ACTIVE);

      await service.retireTieredPlans(RETIREMENT);

      expect(stripe.cancellations).toEqual(CANCELLED_ONCE);
      expect(tieredStatus()).toBe(SubscriptionStatus.CANCELLED);
    });
  });
});
