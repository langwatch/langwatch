/**
 * Developer seats on a live Growth subscription, over memory twins of Stripe and the store.
 * @see specs/licensing/seat-buying.feature
 * @see specs/licensing/seat-quantity-floor.feature
 */
import type { StripePriceMap } from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemorySeatEventSubscriptionRepository } from "../../repositories/memory/memory.seat-event-subscription.repository.ts";
import { DeveloperSeatService, type DevelopersInUseCounter } from "../developer-seat.service.ts";

const BASE_PRICES = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
} as StripePriceMap;
const WITH_DEVELOPER = {
  ...BASE_PRICES,
  DEVELOPER_SEAT_EUR_MONTHLY: "price_dev_eur_monthly",
} as StripePriceMap;

const NOW = Temporal.Instant.from("2026-11-06T12:00:00Z");
const PERIOD_END_SECONDS = Temporal.Instant.from("2026-12-01T00:00:00Z").epochMilliseconds / 1000;
const NOW_SECONDS = NOW.epochMilliseconds / 1000;

/** Developers in use, as licensing counts them; each test sets its own. */
let developersInUse = 0;
const seatsInUse = createApiFixture<DevelopersInUseCounter>({
  countDevelopersInUse: () => Promise.resolve(developersInUse),
});

describe("DeveloperSeatService", () => {
  let stripeSubscriptions: MemoryStripeSubscriptionsChannel;
  let store: MemoryBillingStore;

  const seedProvider = (developerSeats: number) =>
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
            priceId: BASE_PRICES.GROWTH_SEAT_EUR_MONTHLY,
            unitAmount: 2900,
            interval: "month",
            quantity: 3,
          },
          ...(developerSeats > 0
            ? [
                {
                  id: "si_dev",
                  priceId: "price_dev_eur_monthly",
                  unitAmount: 500,
                  interval: "month",
                  quantity: developerSeats,
                },
              ]
            : []),
        ],
      },
    });

  const service = (prices: StripePriceMap) =>
    DeveloperSeatService.create({
      stripeSubscriptions,
      subscriptions: MemorySeatEventSubscriptionRepository.create(store),
      prices,
      unitAmountOf: (priceId) => (priceId === "price_dev_eur_monthly" ? 500 : null),
      seatsInUse,
    });

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW.epochMilliseconds, toFake: ["Date"] });
    developersInUse = 0;
    store = MemoryBillingStore.create();
    store.subscriptions.push({
      id: "sub_db_1",
      organizationId: "org_1",
      status: "ACTIVE",
      plan: "GROWTH_SEAT_EUR_MONTHLY",
      stripeSubscriptionId: "sub_stripe_1",
      createdAt: NOW.subtract({ hours: 24 * 40 }),
      startDate: NOW.subtract({ hours: 24 * 40 }),
      endDate: null,
      maxMembers: 3,
      maxMembersLite: null,
      maxMembersDeveloper: null,
      maxMessagesPerMonth: null,
      lastPaymentFailedDate: null,
      seatsKept: null,
      seatsKeptUntil: null,
    });
    stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when no Developer seat price is configured", () => {
    /** @scenario "Developer seats read as unavailable while no price is configured" */
    it("reads Developer seats as unavailable with no price", async () => {
      seedProvider(0);
      const seats = await service(BASE_PRICES).developerSeats({ organizationId: "org_1" });
      expect(seats).toMatchObject({ available: false, quantity: 0, unitAmountCents: null });
    });

    /** @scenario "Setting Developer seats without a configured price is refused" */
    it("refuses to set Developer seats and leaves the subscription alone", async () => {
      seedProvider(0);
      await expect(
        service(BASE_PRICES).setDeveloperSeats({ organizationId: "org_1", quantity: 2 }),
      ).rejects.toMatchObject({ code: "developer_seats_unavailable" });
      expect(stripeSubscriptions.updates).toEqual([]);
    });
  });

  describe("when a Developer seat price of €5 a month is configured", () => {
    /** @scenario "Developer seats read the configured price and the quantity billed" */
    it("reads the price, the quantity billed and when the period ends", async () => {
      seedProvider(2);
      const seats = await service(WITH_DEVELOPER).developerSeats({ organizationId: "org_1" });
      expect(seats).toEqual({
        available: true,
        quantity: 2,
        unitAmountCents: 500,
        currency: "EUR",
        billingInterval: "month",
        periodEndsAt: PERIOD_END_SECONDS * 1000,
      });
    });

    /** @scenario "Adding Developer seats adds a line at the configured price, charged now" */
    it("adds a Developer seat line invoiced now at the quoted instant", async () => {
      seedProvider(0);
      await service(WITH_DEVELOPER).setDeveloperSeats({
        organizationId: "org_1",
        quantity: 2,
        quotedAt: NOW_SECONDS - 60,
      });
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_stripe_1",
          change: {
            items: [{ price: "price_dev_eur_monthly", quantity: 2 }],
            prorationBehavior: "always_invoice",
            prorationDate: NOW_SECONDS - 60,
          },
        },
      ]);
    });

    /** @scenario "Lowering Developer seats changes the line from the next period with no credit" */
    it("moves the line down with no proration", async () => {
      developersInUse = 1;
      seedProvider(3);
      await service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 1 });
      expect(stripeSubscriptions.updates[0]?.change).toEqual({
        items: [{ id: "si_dev", quantity: 1 }],
        prorationBehavior: "none",
      });
    });

    /** @scenario "Removing every Developer seat removes the line" */
    it("removes the line when set to none", async () => {
      seedProvider(2);
      await service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 0 });
      expect(stripeSubscriptions.updates[0]?.change.items).toEqual([
        { id: "si_dev", deleted: true },
      ]);
    });

    /** @scenario "Removing every Developer seat goes through when no Developer is in use" */
    it("lets the line go when no Developer is in use", async () => {
      developersInUse = 0;
      seedProvider(3);
      await service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 0 });
      expect(stripeSubscriptions.updates[0]?.change.items).toEqual([
        { id: "si_dev", deleted: true },
      ]);
    });

    it("changes nothing when the quantity is already billed", async () => {
      seedProvider(2);
      await service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 2 });
      expect(stripeSubscriptions.updates).toEqual([]);
    });

    /** @scenario "The Developer seat quote prices the change before it is confirmed" */
    it("quotes the amount due today, the monthly price and the instant priced", async () => {
      seedProvider(0);
      stripeSubscriptions.seedPreview({
        preview: { total: 1008, amountDue: 1008, tax: 175, currency: "eur" },
      });
      const quote = await service(WITH_DEVELOPER).previewDeveloperSeats({
        organizationId: "org_1",
        quantity: 2,
      });
      expect(quote).toEqual({
        amountDueCents: 1008,
        formattedAmountDue: "€10.08",
        taxCents: 175,
        formattedRecurringTotal: "€10",
        billingInterval: "month",
        quotedAt: NOW_SECONDS,
      });
      expect(stripeSubscriptions.previews[0]?.change.items).toEqual([
        { price: "price_dev_eur_monthly", quantity: 2 },
      ]);
    });

    describe("when 2 Developers are in use and the subscription bills 3 Developer seats", () => {
      beforeEach(() => {
        developersInUse = 2;
        seedProvider(3);
      });

      /** @scenario "Lowering Developer seats to the Developers in use goes through" */
      it("lowers the line to the Developers in use", async () => {
        await service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 2 });
        expect(stripeSubscriptions.updates[0]?.change).toEqual({
          items: [{ id: "si_dev", quantity: 2 }],
          prorationBehavior: "none",
        });
      });

      /** @scenario "Lowering Developer seats below the Developers in use is refused" */
      it("refuses a count below the Developers in use before calling the payment provider", async () => {
        await expect(
          service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 1 }),
        ).rejects.toMatchObject({
          code: "seat_quantity_below_in_use",
          meta: { seat: "developer", requested: 1, minimum: 2 },
        });
        expect(stripeSubscriptions.updates).toEqual([]);
      });

      /** @scenario "Removing every Developer seat is refused while Developers are in use" */
      it("keeps the line when asked to remove every Developer seat", async () => {
        await expect(
          service(WITH_DEVELOPER).setDeveloperSeats({ organizationId: "org_1", quantity: 0 }),
        ).rejects.toMatchObject({
          code: "seat_quantity_below_in_use",
          meta: { seat: "developer", requested: 0, minimum: 2 },
        });
        expect(stripeSubscriptions.updates).toEqual([]);
      });
    });

    it("refuses when the organization has no live subscription", async () => {
      seedProvider(0);
      store.subscriptions.length = 0;
      await expect(
        service(WITH_DEVELOPER).developerSeats({ organizationId: "org_1" }),
      ).rejects.toMatchObject({ code: "subscription_sync_failed" });
    });
  });
});
