/**
 * @vitest-environment node
 * A Billing-only member on Free starts the Growth checkout; once it completes the plan is
 * Growth and they still hold Billing (ADR-205).
 * @see ../../../../../../../specs/licensing/billing-only-invite.feature
 */
import type { AuthzApi, AuthzSetBillingRoleInput } from "@langwatch/authz-contract";
import { SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import type { BillingWebhookSubscriptionRepository } from "../../repositories/billing-webhook-subscription.repository.ts";
import type { BillingSubscriptionRecord } from "../../repositories/subscription.repository.ts";
import { BillingCheckoutCompletionService } from "../billing-checkout-completion.service.ts";

const ORG = "org-acme";
const PAYER = "user-billing-only";

/** The organization's one subscription row: the PENDING Growth row the checkout created. */
function subscriptionStore() {
  let row: BillingSubscriptionRecord = {
    id: "sub_db_growth",
    organizationId: ORG,
    status: SubscriptionStatus.PENDING,
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    stripeSubscriptionId: null,
    createdAt: Temporal.Now.instant(),
    startDate: null,
    endDate: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
    maxMembers: null,
    maxMembersLite: null,
    maxMembersDeveloper: null,
    maxMessagesPerMonth: null,
  };
  const withOrg = () => ({
    ...row,
    organization: { id: ORG, name: "Acme", stripeCustomerId: null },
  });
  const repository = createApiFixture<BillingWebhookSubscriptionRepository>({
    linkStripeId: async ({
      id,
      stripeSubscriptionId,
    }: {
      id: string;
      stripeSubscriptionId: string;
    }) => {
      if (id !== row.id) return { count: 0 };
      row = { ...row, stripeSubscriptionId };
      return { count: 1 };
    },
    findByStripeId: async (stripeId: string) =>
      row.stripeSubscriptionId === stripeId ? withOrg() : null,
    activate: async () => {
      row = { ...row, status: SubscriptionStatus.ACTIVE, startDate: Temporal.Now.instant() };
      return { outcome: "activated", subscription: withOrg() };
    },
    cancelTrialSubscriptions: async () => {},
    findSupersededBySeatEvent: async () => [],
    findLiveUnlinkedBeside: async () => [],
    findLiveLinkedBeside: async () => [],
  });
  return { repository, current: () => row };
}

function completion() {
  const store = subscriptionStore();
  const billingWrites: AuthzSetBillingRoleInput[] = [];
  const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  stripeSubscriptions.seed({
    subscription: {
      id: "sub_stripe_growth",
      status: "active",
      canceledAt: null,
      billingThreshold: null,
      items: [],
    },
  });
  const service = BillingCheckoutCompletionService.create({
    billingRoles: createApiFixture<AuthzApi>({
      findActiveOrganizationAdministrators: async () => ["user-admin"],
      setBillingRole: async (input) => {
        billingWrites.push(input);
      },
    }),
    subscriptionRepository: store.repository,
    organizationRepository: {
      findByStripeCustomerId: async () => null,
      findNameById: async () => "Acme",
      isOnSeatEventPricing: async () => true,
    } as never,
    stripeSubscriptions,
    itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as never },
    licenses: createApiFixture<LicensingApi>({
      getLicenseStatus: async () => ({ hasLicense: false, valid: false }),
    }),
    host: {
      sendSlackSubscriptionEvent: async () => {},
      sendSlackBillingThresholdFailureAlert: async () => {},
      sendSlackAccountPaymentFailed: async () => {},
    },
  });
  return { service, store, billingWrites };
}

const checkoutCompleted = createApiFixture<Stripe.CheckoutSessionCompletedEvent>({
  id: "evt_growth_checkout",
  type: "checkout.session.completed",
  data: {
    object: createApiFixture<Stripe.Checkout.Session>({
      client_reference_id: "subscription_setup_sub_db_growth",
      created: 1_790_000_000,
      metadata: { startedByUserId: PAYER },
    }),
  },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("given a Billing-only member of an organization on Free", () => {
  describe("when the Growth checkout they started completes", () => {
    /** @scenario "A Billing-only member pays the upgrade on Free" */
    it("makes Growth the active plan and leaves Billing with them", async () => {
      const { service, store, billingWrites } = completion();

      const done = service.dispatchCheckoutCompleted({
        event: checkoutCompleted,
        subscriptionId: "sub_stripe_growth",
        organizationId: ORG,
      });
      await vi.advanceTimersByTimeAsync(5000);
      await done;

      expect(store.current()).toMatchObject({
        status: SubscriptionStatus.ACTIVE,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
      });
      expect(billingWrites).toEqual([
        expect.objectContaining({ organizationId: ORG, userId: PAYER, holds: true }),
      ]);
    });
  });
});
