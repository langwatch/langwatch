/**
 * @vitest-environment node
 *
 * The over-plan mark over memory twins: a downgrade to Free with too many members marks the
 * organization, the plan read answers the state while it holds, and the sweep records its end.
 * @see ../../../../../../specs/billing/over-plan-trace-withholding.feature
 */
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryPaymentRecoveryEmailChannel } from "../../channels/memory/memory.billing.channels.ts";
import { MemoryStripeInvoicesChannel } from "../../channels/memory/memory.stripe-invoices.channel.ts";
import { MemoryBillingOrganizationRepository } from "../../repositories/memory/memory.billing-account-facts.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryOverPlanRepository } from "../../repositories/memory/memory.over-plan.repository.ts";
import { MemoryPaymentRecoveryRepository } from "../../repositories/memory/memory.payment-recovery.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../../repositories/memory/memory.subscription.repository.ts";
import type { BillingLifecycleAnnouncerService } from "../billing-lifecycle-announcer.service.ts";
import { OverPlanService } from "../over-plan.service.ts";
import { PaymentRecoveryService } from "../payment-recovery.service.ts";
import { SaaSPlanProviderService } from "../plan-provider.service.ts";

type OverPlanFact = Parameters<BillingLifecycleAnnouncerService["overPlanChanged"]>[0];

/** The plan read pauses a recovery case by the wall clock, so the test clock starts there. */
const NOW = Temporal.Instant.fromEpochMilliseconds(nowInstant().epochMilliseconds);
const ORG = "org_1";

function setUp({
  members,
  status = "ACTIVE",
  paymentRecoveryStartedAt = null,
}: {
  members: number;
  status?: string;
  paymentRecoveryStartedAt?: Instant | null;
}) {
  const store = MemoryBillingStore.create();
  let now = NOW;
  store.organizations.set(ORG, {
    id: ORG,
    name: "ACME",
    stripeCustomerId: "cus_1",
    pricingModel: "SEAT_EVENT",
    currency: "EUR",
    selfHostedCustomer: false,
    teamIds: [],
    signupData: {},
  });
  for (let index = 0; index < members; index++) {
    const userId = `user_${index}`;
    store.members.push({
      organizationId: ORG,
      userId,
      role: index === 0 ? "ADMIN" : "MEMBER",
      disabled: false,
    });
    store.users.set(userId, {
      id: userId,
      name: null,
      email: `${userId}@acme.test`,
      deactivated: false,
    });
  }
  store.subscriptions.push({
    id: "sub_db_1",
    organizationId: ORG,
    status,
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    stripeSubscriptionId: "sub_stripe_1",
    createdAt: NOW.subtract({ hours: 24 * 60 }),
    startDate: NOW.subtract({ hours: 24 * 60 }),
    endDate: null,
    maxMembers: 5,
    maxMembersLite: null,
    maxMessagesPerMonth: null,
    lastPaymentFailedDate: null,
    seatsKept: null,
    seatsKeptUntil: null,
    ...(paymentRecoveryStartedAt
      ? {
          paymentRecoveryInvoiceId: "in_renewal",
          paymentRecoveryStartedAt,
          paymentRecoveryNoticeDay: 14,
        }
      : {}),
  });
  const subscriptions = MemoryBillingSubscriptionRepository.create(store);
  const plans = SaaSPlanProviderService.create({ subscriptions, isSaas: true });
  const marks = MemoryOverPlanRepository.create(store);
  const organizations = MemoryBillingOrganizationRepository.create(store);
  const facts: OverPlanFact[] = [];
  const overPlan = OverPlanService.create({
    marks,
    organizations,
    isOnFree: async (organizationId) => (await plans.getActivePlan(organizationId)).free,
    facts: {
      overPlanChanged: async (fact) => {
        facts.push(fact);
      },
    },
    now: () => now,
  });
  return {
    store,
    marks,
    facts,
    overPlan,
    organizations,
    subscriptions,
    cancel: () => {
      store.subscriptions[0] = { ...store.subscriptions[0]!, status: "CANCELLED" };
    },
    removeMembers: (count: number) => {
      store.members.splice(store.members.length - count, count);
    },
    advance: (hours: number) => {
      now = now.add({ hours });
    },
  };
}

describe("OverPlanService", () => {
  describe("when an organization with 5 members cancels into Free", () => {
    /** @scenario "Cancelling with more members than Free allows starts the over-plan state" */
    it("marks it from the cancellation time and records the started fact", async () => {
      const world = setUp({ members: 5 });
      world.cancel();

      await world.overPlan.downgraded({
        organizationId: ORG,
        subscriptionId: "sub_db_1",
        since: NOW,
        reason: "cancelled",
      });

      expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
        kind: "over_plan",
        overPlan: {
          sinceMs: NOW.epochMilliseconds,
          members: 5,
          maxMembers: 2,
        },
      });
      expect(world.facts).toEqual([
        expect.objectContaining({
          state: "started",
          reason: "cancelled",
          since: NOW,
          members: 5,
          maxMembers: 2,
        }),
      ]);
    });
  });

  describe("when an organization with 2 members cancels into Free", () => {
    /** @scenario "Cancelling within the Free member limit starts nothing" */
    it("marks nothing and records no fact", async () => {
      const world = setUp({ members: 2 });
      world.cancel();

      await world.overPlan.downgraded({
        organizationId: ORG,
        subscriptionId: "sub_db_1",
        since: NOW,
        reason: "cancelled",
      });

      expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
        kind: "within_plan",
      });
      expect(world.facts).toEqual([]);
    });
  });

  describe("when a replaced subscription ends while another plan is active", () => {
    it("marks nothing: the organization is not on Free", async () => {
      const world = setUp({ members: 5 });

      await world.overPlan.downgraded({
        organizationId: ORG,
        subscriptionId: "sub_db_1",
        since: NOW,
        reason: "cancelled",
      });

      expect(await world.marks.findOpen()).toEqual([]);
    });
  });

  describe("when an unpaid renewal reaches day 21 with 4 members", () => {
    /** @scenario "An unpaid renewal reaching day 21 with too many members starts the state at day 21" */
    it("marks the organization from day 21 of the case", async () => {
      const day0 = NOW.subtract({ hours: 24 * 21 + 3 });
      const world = setUp({ members: 4, paymentRecoveryStartedAt: day0 });
      const invoices = MemoryStripeInvoicesChannel.create();
      invoices.seed({
        invoice: {
          id: "in_renewal",
          customerId: "cus_1",
          number: "LW-0042",
          created: day0.epochMilliseconds / 1000,
          amountDue: 28072,
          currency: "eur",
          status: "open",
          pdfUrl: null,
          hostedUrl: "https://invoice.stripe.test/in_renewal",
        },
        card: { brand: "Visa", last4: "4242" },
      });
      const recovery = PaymentRecoveryService.create({
        recoveries: MemoryPaymentRecoveryRepository.create(world.store),
        subscriptions: MemoryBillingWebhookSubscriptionRepository.create({
          subscriptions: world.subscriptions,
          store: world.store,
        }),
        organizations: world.organizations,
        invoices,
        emails: MemoryPaymentRecoveryEmailChannel.create(),
        alerts: { sendSlackAccountPaymentFailed: async () => {} },
        publicBaseUrl: "https://app.langwatch.test",
        overPlan: world.overPlan,
        now: () => NOW,
      });

      await recovery.sweep();

      expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
        kind: "over_plan",
        overPlan: {
          sinceMs: day0.add({ hours: 24 * 21 }).epochMilliseconds,
          members: 4,
          maxMembers: 2,
        },
      });
      expect(world.facts).toEqual([
        expect.objectContaining({ state: "started", reason: "payment_recovery" }),
      ]);
    });
  });

  describe("when an organization on Free has 6 members and no recorded downgrade", () => {
    /** @scenario "An organization over its member count without a recorded downgrade is never affected" */
    it("answers no over-plan state", async () => {
      const world = setUp({ members: 6, status: "CANCELLED" });

      expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
        kind: "within_plan",
      });
    });
  });

  describe("given an organization over its plan", () => {
    async function overPlanWorld({ members }: { members: number }) {
      const world = setUp({ members });
      world.cancel();
      await world.overPlan.downgraded({
        organizationId: ORG,
        subscriptionId: "sub_db_1",
        since: NOW,
        reason: "cancelled",
      });
      world.facts.length = 0;
      return world;
    }

    describe("when it subscribes to Growth again", () => {
      /** @scenario "The state ends at once when the organization is back on a paid plan" */
      it("ends at once in the plan read and the sweep ends the mark", async () => {
        const world = await overPlanWorld({ members: 5 });
        world.store.subscriptions.push({
          ...world.store.subscriptions[0]!,
          id: "sub_db_2",
          stripeSubscriptionId: "sub_stripe_2",
          status: "ACTIVE",
          overPlanSince: null,
          overPlanEndedAt: null,
        });

        const plans = SaaSPlanProviderService.create({
          subscriptions: world.subscriptions,
          isSaas: true,
        });
        expect((await plans.getActivePlan(ORG)).free).toBe(false);
        expect(await world.overPlan.sweep()).toEqual({ ended: 1, failed: 0 });
        expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
          kind: "within_plan",
        });
      });
    });

    describe("when an administrator removes 1 of its 3 members", () => {
      /** @scenario "The state ends at once when the members fit the Free plan" */
      it("answers no over-plan state on the next read", async () => {
        const world = await overPlanWorld({ members: 3 });
        expect(await world.overPlan.getState({ organizationId: ORG })).toMatchObject({
          kind: "over_plan",
        });

        world.removeMembers(1);

        expect(await world.overPlan.getState({ organizationId: ORG })).toEqual({
          kind: "within_plan",
        });
      });
    });

    describe("when its members now fit and the sweep runs", () => {
      /** @scenario "The sweep records the end of a state whose condition no longer holds" */
      it("ends the mark and records the ended fact once", async () => {
        const world = await overPlanWorld({ members: 4 });
        world.removeMembers(2);
        world.advance(1);

        expect(await world.overPlan.sweep()).toEqual({ ended: 1, failed: 0 });
        expect(await world.overPlan.sweep()).toEqual({ ended: 0, failed: 0 });

        expect(await world.marks.findOpen()).toEqual([]);
        expect(world.facts).toEqual([
          expect.objectContaining({
            state: "ended",
            reason: "within_plan",
            since: NOW,
            members: 2,
          }),
        ]);
      });
    });

    describe("when it still holds 5 members on Free and the sweep runs", () => {
      /** @scenario "A state still in force stays open on the sweep" */
      it("keeps the mark open and records nothing", async () => {
        const world = await overPlanWorld({ members: 5 });

        expect(await world.overPlan.sweep()).toEqual({ ended: 0, failed: 0 });

        expect(await world.marks.findOpen()).toHaveLength(1);
        expect(world.facts).toEqual([]);
      });
    });
  });
});
