/**
 * Growth seats are added now, prorated, and lowered from the next billing cycle, through the
 * seat service, the subscription webhook and the plan the seat limit reads, on memory twins.
 * @see specs/licensing/seat-rotation.feature
 */
import { type StripePriceMap } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi, LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeCustomersChannel } from "../channels/memory/memory.stripe-customers.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingWebhookOrganizationRepository } from "../repositories/memory/memory.billing-webhook-organization.repository.ts";
import { MemoryBillingWebhookSubscriptionRepository } from "../repositories/memory/memory.billing-webhook-subscription.repository.ts";
import { MemoryBillingStore } from "../repositories/memory/memory.billing.store.ts";
import { MemorySeatEventSubscriptionRepository } from "../repositories/memory/memory.seat-event-subscription.repository.ts";
import { MemoryBillingSubscriptionRepository } from "../repositories/memory/memory.subscription.repository.ts";
import { BillingSubscriptionLifecycleService } from "../services/billing-subscription-lifecycle.service.ts";
import { SaaSPlanProviderService } from "../services/plan-provider.service.ts";
import { SeatEventSubscriptionService } from "../services/seat-event-subscription.service.ts";
import { StripeCustomerCurrencyService } from "../services/stripe-customer-currency.service.ts";
import { StripeErrorTranslatorService } from "../services/stripe-error-translator.service.ts";

const prices = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
  GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
} as StripePriceMap;

const NOW = Temporal.Instant.from("2026-11-06T12:00:00Z");
const PERIOD_END = Temporal.Instant.from("2026-12-01T00:00:00Z");
const PERIOD_END_SECONDS = PERIOD_END.epochMilliseconds / 1000;
const SEAT_PRICE_CENTS = 2900;

/** The provider's update event once the line bills 3 seats; only the fields the sync reads. */
const PROVIDER_AT_THREE = {
  id: "sub_stripe_1",
  status: "active",
  ended_at: null,
  items: { data: [{ price: { id: prices.GROWTH_SEAT_EUR_MONTHLY }, quantity: 3 }] },
} as Stripe.Subscription;

describe("Growth seat changes", () => {
  let store: MemoryBillingStore;
  let stripeSubscriptions: MemoryStripeSubscriptionsChannel;
  let seats: SeatEventSubscriptionService;
  let plans: SaaSPlanProviderService;
  let lifecycle: BillingSubscriptionLifecycleService;

  /** The provider's seat line as it bills `quantity` seats this period. */
  const seedProvider = (quantity: number) =>
    stripeSubscriptions.seed({
      subscription: {
        id: "sub_stripe_1",
        status: "active",
        canceledAt: null,
        billingThreshold: null,
        currentPeriodEnd: PERIOD_END_SECONDS,
        currency: "eur",
        items: [
          {
            id: "si_seat",
            priceId: prices.GROWTH_SEAT_EUR_MONTHLY,
            unitAmount: SEAT_PRICE_CENTS,
            interval: "month",
            quantity,
          },
        ],
      },
    });

  const planSeats = async () => (await plans.getActivePlan("org_1")).maxMembers;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW.epochMilliseconds, toFake: ["Date", "setTimeout"] });
    store = MemoryBillingStore.create();
    store.organizations.set("org_1", {
      id: "org_1",
      name: "ACME",
      stripeCustomerId: "cus_1",
      pricingModel: "SEAT_EVENT",
      currency: "EUR",
      selfHostedCustomer: false,
      teamIds: [],
      signupData: {},
    });
    store.subscriptions.push({
      id: "sub_db_1",
      organizationId: "org_1",
      status: "ACTIVE",
      plan: "GROWTH_SEAT_EUR_MONTHLY",
      stripeSubscriptionId: "sub_stripe_1",
      createdAt: NOW.subtract({ hours: 24 * 40 }),
      startDate: NOW.subtract({ hours: 24 * 40 }),
      endDate: null,
      maxMembers: 5,
      maxMembersLite: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
    stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
    seedProvider(5);
    const customers = MemoryStripeCustomersChannel.create();
    customers.seed({ id: "cus_1", currency: "eur" });
    seats = SeatEventSubscriptionService.create({
      stripeSubscriptions,
      subscriptions: MemorySeatEventSubscriptionRepository.create(store),
      abandoned: { seatCheckoutsAbandoned: vi.fn() },
      prices,
      customerCurrency: StripeCustomerCurrencyService.create({
        customers,
        stripeErrors: StripeErrorTranslatorService.create(),
      }),
    });
    const subscriptions = MemoryBillingSubscriptionRepository.create(store);
    plans = SaaSPlanProviderService.create({ subscriptions, isSaas: true });
    lifecycle = BillingSubscriptionLifecycleService.create({
      subscriptionRepository: MemoryBillingWebhookSubscriptionRepository.create({
        subscriptions,
        store,
      }),
      organizationRepository: MemoryBillingWebhookOrganizationRepository.create(store),
      licenses: createApiFixture<LicensingApi>({
        getLicenseStatus: async () => ({ hasLicense: false }) as LicenseStatus,
      }),
      stripeSubscriptions,
      itemCalculator: { calculateQuantityForPrice: vi.fn().mockReturnValue(0), prices },
      host: {
        sendSlackSubscriptionEvent: vi.fn(),
        sendSlackBillingThresholdFailureAlert: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when an administrator raises the seats", () => {
    /** @scenario "Adding seats charges the prorated amount now" */
    it("invoices the prorated difference at once and grants the seats at once", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: {
            items: [{ id: "si_seat", quantity: 6 }],
            prorationBehavior: "always_invoice",
            prorationDate: Math.floor(NOW.epochMilliseconds / 1000),
          },
        },
      ]);
      expect(await planSeats()).toBe(6);
    });
  });

  describe("when an administrator lowers the seats", () => {
    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("changes the quantity with no proration and keeps the seats paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });

      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
        },
      ]);
      expect(await planSeats()).toBe(5);

      vi.setSystemTime(PERIOD_END.add({ hours: 1 }).epochMilliseconds);
      expect(await planSeats()).toBe(3);
    });

    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("keeps the seats when the provider reports the lower quantity before the period ends", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });

      const synced = lifecycle.handleSubscriptionUpdated({ subscription: PROVIDER_AT_THREE });
      await vi.advanceTimersByTimeAsync(2000);
      await synced;

      expect(store.subscriptions[0]?.maxMembers).toBe(3);
      expect(await planSeats()).toBe(5);
    });

    /** @scenario "Lowering seats applies from the next billing cycle" */
    it("keeps the seats paid for when the provider lowered the line but the record failed", async () => {
      const repository = MemorySeatEventSubscriptionRepository.create(store);
      const failingRecord = SeatEventSubscriptionService.create({
        stripeSubscriptions,
        subscriptions: createApiFixture<MemorySeatEventSubscriptionRepository>({
          findSeatCandidates: (input) => repository.findSeatCandidates(input),
          keepSeats: (input) => repository.keepSeats(input),
          reactivateWithSeats: async () => {
            throw new Error("database unavailable");
          },
        }),
        abandoned: { seatCheckoutsAbandoned: vi.fn() },
        prices,
        customerCurrency: StripeCustomerCurrencyService.create({
          customers: MemoryStripeCustomersChannel.create(),
          stripeErrors: StripeErrorTranslatorService.create(),
        }),
      });

      await expect(
        failingRecord.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 }),
      ).rejects.toThrow("database unavailable");
      const synced = lifecycle.handleSubscriptionUpdated({ subscription: PROVIDER_AT_THREE });
      await vi.advanceTimersByTimeAsync(2000);
      await synced;

      expect(store.subscriptions[0]?.maxMembers).toBe(3);
      expect(await planSeats()).toBe(5);
    });

    it("previews nothing due today and the day the lower count applies", async () => {
      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 3 });

      expect(quote).toMatchObject({
        amountDueCents: 0,
        formattedRecurringTotal: "€87",
        appliesAt: PERIOD_END.epochMilliseconds,
        keptSeats: 5,
        formattedKeptRecurringTotal: "€145",
      });
      expect(stripeSubscriptions.previews).toEqual([]);
    });
  });

  describe("when an administrator raises the seats again before the kept seats run out", () => {
    beforeEach(async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 3 });
      seedProvider(3);
      stripeSubscriptions.updates.length = 0;
    });

    it("charges nothing for a count within the seats already paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 4 });

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 4 }], prorationBehavior: "none" },
      ]);
      expect(await planSeats()).toBe(5);
    });

    it("charges only the seats above the ones already paid for", async () => {
      await seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 });

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
        expect.objectContaining({
          items: [{ id: "si_seat", quantity: 6 }],
          prorationBehavior: "always_invoice",
        }),
      ]);
      expect(await planSeats()).toBe(6);
    });

    it("puts the line back when the charge after the lift is refused", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("card declined"),
        allowed: 1,
        times: 1,
      });

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("card declined");

      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
        { items: [{ id: "si_seat", quantity: 3 }], prorationBehavior: "none" },
      ]);
      expect(store.subscriptions[0]).toMatchObject({ maxMembers: 3, seatsKept: 5 });
    });

    it("reports the refused charge when putting the line back fails too", async () => {
      stripeSubscriptions.refuse({
        operation: "updateSubscription",
        error: new Error("card declined"),
        allowed: 1,
        times: 2,
      });

      await expect(
        seats.updateSeatEventItems({ organizationId: "org_1", totalMembers: 6 }),
      ).rejects.toThrow("card declined");

      // The lifted line stays; the kept seats recorded first still cover what Stripe bills.
      expect(stripeSubscriptions.updates.map((update) => update.change)).toEqual([
        { items: [{ id: "si_seat", quantity: 5 }], prorationBehavior: "none" },
      ]);
      expect(store.subscriptions[0]).toMatchObject({ maxMembers: 3, seatsKept: 5 });
    });

    it("quotes the share of the previewed proration above the seats already paid for", async () => {
      // The preview prices the move from 3 to 6, the lift the move from 3 to 5; one seat is due.
      stripeSubscriptions.seedPreview({
        preview: { total: 5400, amountDue: 5400, currency: "eur" },
        quantity: 6,
      });
      stripeSubscriptions.seedPreview({
        preview: { total: 3600, amountDue: 3600, currency: "eur" },
        quantity: 5,
      });

      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 6 });

      expect(quote).toMatchObject({ amountDueCents: 1800, appliesAt: null, keptSeats: null });
    });

    /** @scenario "Amount due counts prorations the subscription already carried" */
    it("quotes a carried proration in full beside the seat above the ones paid for", async () => {
      // 1000 carried from an earlier change sits on both previews; one seat costs 1800.
      stripeSubscriptions.seedPreview({
        preview: { total: 6400, amountDue: 6400, currency: "eur" },
        quantity: 6,
      });
      stripeSubscriptions.seedPreview({
        preview: { total: 4600, amountDue: 4600, currency: "eur" },
        quantity: 5,
      });

      const quote = await seats.previewProration({ organizationId: "org_1", newTotalSeats: 6 });

      expect(quote.amountDueCents).toBe(2800);
    });
  });
});
