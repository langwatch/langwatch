/**
 * @vitest-environment node
 * An expired seat checkout ends its pending row and tells peers it was abandoned.
 * @see ../../../../../../../specs/licensing/role-change-seat.feature
 */
import { type StripePriceMap, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import { BillingCheckoutCompletionService } from "../billing-checkout-completion.service.ts";

const ORG = "org_acme";
const NOW = Temporal.Instant.from("2026-11-26T12:00:00Z");

function world({ status }: { status: string }) {
  const store = MemoryBillingStore.create();
  store.subscriptions.push({
    id: "sub_db_checkout",
    organizationId: ORG,
    status,
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    stripeSubscriptionId: null,
    createdAt: NOW,
    startDate: null,
    endDate: null,
    maxMembers: 3,
    maxMembersLite: null,
    maxMembersDeveloper: null,
    maxMessagesPerMonth: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
  });
  const seatCheckoutsAbandoned = vi.fn(async () => undefined);
  const quiet = vi.fn(async () => undefined);
  const completion = BillingCheckoutCompletionService.create({
    subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
      subscriptions: MemoryBillingSubscriptionRepository.create(store),
      store,
    }),
    organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
    stripeSubscriptions: MemoryStripeSubscriptionsChannel.create(),
    itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as StripePriceMap },
    licenses: createApiFixture<LicensingApi>({
      getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
    }),
    host: {
      sendSlackSubscriptionEvent: async () => {},
      sendSlackBillingThresholdFailureAlert: async () => {},
      sendSlackAccountPaymentFailed: async () => {},
    },
    announcer: {
      checkoutCompleted: quiet,
      subscriptionActivated: quiet,
      subscriptionCancelled: quiet,
      checkoutCurrencySelected: quiet,
      seatCheckoutPaid: quiet,
      pricingModelChanged: quiet,
      audited: quiet,
      seatCheckoutsAbandoned,
    },
  });
  const expire = () =>
    completion.dispatchCheckoutExpired({
      event: createApiFixture<Stripe.CheckoutSessionExpiredEvent>({
        id: "evt_expired",
        type: "checkout.session.expired",
        data: {
          object: createApiFixture<Stripe.Checkout.Session>({
            client_reference_id: "subscription_setup_sub_db_checkout",
          }),
        },
      }),
    });
  const row = () => store.subscriptions.find((s) => s.id === "sub_db_checkout");
  return { expire, row, seatCheckoutsAbandoned };
}

describe("when Stripe expires a seat checkout", () => {
  /** @scenario "An expired seat checkout fails its change at once" */
  it("cancels its pending row and announces the checkout abandoned", async () => {
    const { expire, row, seatCheckoutsAbandoned } = world({ status: SubscriptionStatus.PENDING });
    await expire();
    expect(row()?.status).toBe(SubscriptionStatus.CANCELLED);
    expect(seatCheckoutsAbandoned).toHaveBeenCalledWith({
      organizationId: ORG,
      subscriptionIds: ["sub_db_checkout"],
    });
  });

  /** @scenario "An expired seat checkout fails its change at once" */
  it("leaves a row that is no longer pending alone and announces nothing", async () => {
    const { expire, row, seatCheckoutsAbandoned } = world({ status: SubscriptionStatus.ACTIVE });
    await expire();
    expect(row()?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(seatCheckoutsAbandoned).not.toHaveBeenCalled();
  });
});
