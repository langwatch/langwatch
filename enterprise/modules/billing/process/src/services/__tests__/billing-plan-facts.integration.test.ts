// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Billing's half of the linked plan tests: the recorded fact equals the fixture nurturing delivers.
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import {
  SUBSCRIPTION_CHANGED_TEST_AT,
  subscriptionChangedFacts,
} from "@langwatch/enterprise-billing-contract/testing";
import type { LicenseStatus, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type Instant, Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { subscriptionChangedKeyOf } from "../../eventing/billing-lifecycle.commands.ts";
import type { RecordSubscriptionChangedCommandData } from "../../eventing/billing-lifecycle.events.ts";
import { MemoryBillingOrganizationRepository } from "../../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { BillingSubscriptionLifecycleService } from "../billing-subscription-lifecycle.service.ts";
import { CustomerIoPlanResyncService } from "../customer-io-plan-resync.service.ts";

const AT = Temporal.Instant.fromEpochMilliseconds(SUBSCRIPTION_CHANGED_TEST_AT);
const STRIPE_CONSISTENCY_WAIT_MS = 2000;

/** A subscription row as billing holds it, `ageHours` before the fixture's instant. */
type Held = { id: string; status: string; plan: string; ageHours: number };

const stripeIdOf = (id: string) => `stripe_${id}`;

function recorder<Payload>(kept: Payload[] = []): EventingCommandSender<Payload> {
  return {
    send: async (payload) => void kept.push(payload),
    sendBatch: async (payloads) => void kept.push(...payloads),
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

/**
 * Billing over memory twins: org-1 ("Acme") with two active members and the subscriptions held,
 * its lifecycle service and a real announcer on clock `now`, recording the subscription_changed
 * facts.
 */
function billingOver(held: readonly Held[], now: () => Instant = () => AT) {
  const store = MemoryBillingStore.create();
  store.organizations.set("org-1", {
    id: "org-1",
    name: "Acme",
    stripeCustomerId: "cus_1",
    pricingModel: null,
    currency: null,
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  for (const [index, userId] of ["user-1", "user-2"].entries()) {
    store.users.set(userId, {
      id: userId,
      name: null,
      email: `${userId}@example.com`,
      deactivated: false,
    });
    store.members.push({
      organizationId: "org-1",
      userId,
      role: index === 0 ? "ADMIN" : "MEMBER",
      disabled: false,
    });
  }
  const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  for (const { id, status, plan, ageHours } of held) {
    const createdAt = AT.subtract({ hours: ageHours });
    store.subscriptions.push({
      id,
      organizationId: "org-1",
      status,
      plan,
      stripeSubscriptionId: stripeIdOf(id),
      createdAt,
      startDate: status === "ACTIVE" ? createdAt : null,
      endDate: null,
      maxMembers: null,
      maxMembersLite: null,
      maxMembersDeveloper: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
    stripeSubscriptions.seed({
      subscription: {
        id: stripeIdOf(id),
        status: "active",
        canceledAt: null,
        billingThreshold: null,
        items: [],
      },
    });
  }
  const subscriptions = MemoryBillingSubscriptionRepository.create(store);
  const organizations = MemoryBillingOrganizationRepository.create(store);
  const changed: RecordSubscriptionChangedCommandData[] = [];
  const announcer = BillingLifecycleAnnouncerService.create({
    subscriptions,
    organizations,
    resourceLimitAlerts: { notifyResourceLimitReached: async () => {} },
    planLimitAlerts: { notifyPlanLimitReached: async () => {} },
    billingOrganizations: {
      getOrganizationForBilling: async () => ({ outcome: "not_usage_billed" }),
    },
    now,
  });
  announcer.connect({
    recordSubscriptionChanged: recorder(changed),
    recordSubscriptionStarted: recorder(),
    recordCheckoutCompleted: recorder(),
    recordUsageBillingChanged: recorder(),
    recordAudit: recorder(),
    recordPlanLimitAlertSent: recorder(),
    recordCheckoutCurrencySelected: recorder(),
    recordPricingModelChanged: recorder(),
    recordSeatCheckoutPaid: recorder(),
    recordSeatCheckoutsAbandoned: recorder(),
    recordOverPlanChanged: recorder(),
  });
  const lifecycle = BillingSubscriptionLifecycleService.create({
    subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
      subscriptions,
      store,
    }),
    organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
    licenses: createApiFixture<LicensingApi>({
      getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
    }),
    stripeSubscriptions,
    itemCalculator: { calculateQuantityForPrice: () => 0, prices: {} as StripePriceMap },
    host: {
      sendSlackSubscriptionEvent: async () => {},
      sendSlackBillingThresholdFailureAlert: async () => {},
      sendSlackAccountPaymentFailed: async () => {},
    },
    announcer,
  });
  const statusOf = (id: string) => store.subscriptions.find((row) => row.id === id)?.status;
  return { lifecycle, announcer, organizations, changed, statusOf };
}

/** Lets a webhook handler past its wait for Stripe's own consistency. */
async function settled(work: Promise<void>): Promise<void> {
  await vi.advanceTimersByTimeAsync(STRIPE_CONSISTENCY_WAIT_MS);
  await work;
}

describe("billing's subscription_changed fact, as nurturing's linked tests deliver it", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: SUBSCRIPTION_CHANGED_TEST_AT, toFake: ["Date", "setTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given an organization on an active tiered subscription", () => {
    /** @scenario "A paid-to-paid change shows the new plan and never free" */
    it("records the seat-event plan once, never free, and skips the old one's Stripe delete", async () => {
      const { lifecycle, changed, statusOf } = billingOver([
        { id: "sub-tiered", status: "ACTIVE", plan: "LAUNCH", ageHours: 24 * 40 },
        { id: "sub-seat", status: "PENDING", plan: "GROWTH_SEAT_EUR_MONTHLY", ageHours: 1 },
      ]);

      await settled(
        lifecycle.syncInvoicePaymentSuccess({ subscriptionId: stripeIdOf("sub-seat") }),
      );
      await settled(
        lifecycle.handleSubscriptionDeleted({ stripeSubscriptionId: stripeIdOf("sub-tiered") }),
      );

      expect(changed).toEqual([subscriptionChangedFacts.seatEventActivated]);
      expect(changed.map(({ plan }) => plan)).not.toContain("FREE");
      expect(statusOf("sub-tiered")).toBe("CANCELLED");
    });
  });

  describe("given an organization whose only active subscription is cancelled", () => {
    /** @scenario "Cancelling the last active subscription returns the organization to free" */
    it("records plan FREE and no subscription", async () => {
      const { lifecycle, changed } = billingOver([
        { id: "sub-1", status: "ACTIVE", plan: "LAUNCH", ageHours: 24 },
      ]);

      await settled(
        lifecycle.handleSubscriptionDeleted({ stripeSubscriptionId: stripeIdOf("sub-1") }),
      );

      expect(changed).toEqual([subscriptionChangedFacts.lastCancelled]);
    });
  });

  describe("given an organization with two active subscriptions on different plans", () => {
    /** @scenario "Cancelling one of two subscriptions keeps the other's plan" */
    it("records the remaining subscription's plan", async () => {
      const { lifecycle, changed } = billingOver([
        { id: "sub-launch", status: "ACTIVE", plan: "LAUNCH", ageHours: 48 },
        { id: "sub-accelerate", status: "ACTIVE", plan: "ACCELERATE", ageHours: 24 },
      ]);

      await settled(
        lifecycle.handleSubscriptionDeleted({ stripeSubscriptionId: stripeIdOf("sub-accelerate") }),
      );

      expect(changed).toEqual([subscriptionChangedFacts.otherRemains]);
    });
  });

  describe("given an organization whose only non-cancelled subscription is pending payment", () => {
    /** @scenario "A pending checkout does not make the plan paid" */
    it("records plan FREE and no subscription, since a pending checkout is not one", async () => {
      const { lifecycle, changed } = billingOver([
        { id: "sub-1", status: "ACTIVE", plan: "LAUNCH", ageHours: 48 },
        { id: "sub-pending", status: "PENDING", plan: "GROWTH_SEAT_EUR_MONTHLY", ageHours: 1 },
      ]);

      await settled(
        lifecycle.handleSubscriptionDeleted({ stripeSubscriptionId: stripeIdOf("sub-1") }),
      );

      expect(changed).toEqual([subscriptionChangedFacts.pendingOnly]);
    });
  });

  describe("given an organization with an active subscription", () => {
    const held: Held[] = [{ id: "sub-1", status: "ACTIVE", plan: "LAUNCH", ageHours: 24 * 31 }];

    /** @scenario "A renewal or a seat change tells Customer.io nothing" */
    it("records no fact when Stripe reports a renewal", async () => {
      const { lifecycle, changed } = billingOver(held);

      await settled(lifecycle.syncInvoicePaymentSuccess({ subscriptionId: stripeIdOf("sub-1") }));

      expect(changed).toEqual([]);
    });

    /** @scenario "A renewal or a seat change tells Customer.io nothing" */
    it("records no fact when Stripe reports a seat quantity change", async () => {
      const { lifecycle, changed } = billingOver(held);
      // Only the fields the sync reads, as seat-rotation.unit.test.ts builds the provider's update.
      const update = {
        id: stripeIdOf("sub-1"),
        status: "active",
        ended_at: null,
        items: { data: [{ price: { id: "price_launch_users" }, quantity: 3 }] },
      } as Stripe.Subscription;

      await settled(lifecycle.handleSubscriptionUpdated({ subscription: update }));

      expect(changed).toEqual([]);
    });
  });

  describe("given an organization with a plan and members", () => {
    /**
     * @scenario "A resync run records each organization's plan and members once and a second run sends the same values"
     */
    it("records the same catch-up fact on each of two runs, each under its own key", async () => {
      let readAt = AT;
      const { announcer, organizations, changed } = billingOver(
        [{ id: "sub-1", status: "ACTIVE", plan: "LAUNCH", ageHours: 24 }],
        () => readAt,
      );
      const resync = CustomerIoPlanResyncService.create({
        peers: {
          organizations,
          catchUp: (input) => announcer.customerIoPlanCaughtUp(input),
        },
      });
      const run = () =>
        resync.resync({
          dryRun: false,
          signal: new AbortController().signal,
          onPage: async () => {},
        });

      const first = await run();
      readAt = AT.add({ minutes: 5 });
      const second = await run();

      const { caughtUp } = subscriptionChangedFacts;
      expect(changed).toEqual([
        { ...caughtUp, occurredAt: AT.epochMilliseconds },
        { ...caughtUp, occurredAt: readAt.epochMilliseconds },
      ]);
      expect(new Set(changed.map(subscriptionChangedKeyOf)).size).toBe(2);
      expect(first).toEqual(second);
      expect(first).toMatchObject({ organizations: 1, members: 2, factsRecorded: 1 });
    });

    it("records nothing on a dry run and reports what a real run would send", async () => {
      const { announcer, organizations, changed } = billingOver([
        { id: "sub-1", status: "ACTIVE", plan: "LAUNCH", ageHours: 24 },
      ]);
      const saves: unknown[] = [];
      const resync = CustomerIoPlanResyncService.create({
        peers: {
          organizations,
          catchUp: (input) => announcer.customerIoPlanCaughtUp(input),
        },
      });

      const report = await resync.resync({
        dryRun: true,
        signal: new AbortController().signal,
        onPage: async (page) => void saves.push(page),
      });

      expect(changed).toEqual([]);
      expect(saves).toEqual([]);
      expect(report).toEqual({
        afterOrganizationId: "org-1",
        organizations: 1,
        members: 2,
        factsRecorded: 0,
        maxGroupCalls: 1,
        maxIdentifies: 2,
        skipped: { no_active_members: 0 },
      });
    });
  });
});
