// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The storage line and the daily meter report for retention above 90 days.
 * @see specs/billing/retention-storage-billing.feature
 */
import { type StripePriceMap, SubscriptionStatus } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { MemoryStripeMetersChannel } from "../../channels/memory/memory.stripe-meters.channel.ts";
import { MemoryStripeSubscriptionsChannel } from "../../channels/memory/memory.stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../../repositories/seat-event-subscription.repository.ts";
import type { BillingSubscription } from "../../rules/billing-stripe-shapes.rules.ts";
import {
  RETENTION_STORAGE_METER_EVENT_NAME,
  RetentionStorageBillingService,
} from "../retention-storage-billing.service.ts";

const ORGANIZATION_ID = "organization-1";
/** 2026-11-15T12:00:00Z: a day in a 30 day month. */
const NOVEMBER_15 = Date.UTC(2026, 10, 15, 12);

const prices = {
  GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  RETENTION_STORAGE_EUR_MONTHLY: "price_storage_eur_monthly",
  RETENTION_STORAGE_EUR_ANNUAL: "price_storage_eur_annual",
} as StripePriceMap;

type Candidates = Pick<SeatEventSubscriptionRepository, "findSeatCandidates">;

function activeCandidate(): Candidates {
  return {
    findSeatCandidates: async () =>
      [
        { id: "sub-row-1", status: SubscriptionStatus.ACTIVE, stripeSubscriptionId: "sub_1" },
      ] as Awaited<ReturnType<Candidates["findSeatCandidates"]>>,
  };
}

function noCandidate(): Candidates {
  return { findSeatCandidates: async () => [] };
}

function subscription({
  withStorage = false,
  interval = "month",
}: {
  withStorage?: boolean;
  interval?: "month" | "year";
} = {}): BillingSubscription {
  const seatPrice = interval === "year" ? "price_seat_eur_annual" : "price_seat_eur_monthly";
  return {
    id: "sub_1",
    status: "active",
    canceledAt: null,
    billingThreshold: null,
    currency: "eur",
    customerId: "cus_1",
    items: [
      { id: "si_seat", priceId: seatPrice, unitAmount: 2900, interval, quantity: 2 },
      ...(withStorage
        ? [
            {
              id: "si_storage",
              priceId: "price_storage_eur_monthly",
              unitAmount: null,
              interval,
            },
          ]
        : []),
    ],
  };
}

function setup({
  held = subscription(),
  candidates = activeCandidate(),
  servicePrices = prices,
  isMeterProvisioned = true,
}: {
  held?: BillingSubscription;
  candidates?: Candidates;
  servicePrices?: StripePriceMap;
  isMeterProvisioned?: boolean;
} = {}) {
  const stripeSubscriptions = MemoryStripeSubscriptionsChannel.create();
  stripeSubscriptions.seed({ subscription: held });
  const meters = MemoryStripeMetersChannel.create();
  const service = RetentionStorageBillingService.create({
    subscriptions: candidates,
    stripeSubscriptions,
    meters,
    prices: servicePrices,
    isMeterProvisioned,
    now: () => NOVEMBER_15,
  });
  return { service, stripeSubscriptions, meters };
}

describe("RetentionStorageBillingService", () => {
  describe("when a day's storage is reported on a subscription with the storage line", () => {
    /** @scenario "A day's measurement is reported as its share of a GB-month" */
    it("sends that day's share of a GB-month to the meter", async () => {
      const { service, meters, stripeSubscriptions } = setup({
        held: subscription({ withStorage: true }),
      });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
        bytesAboveIncluded: 30e9,
        measuredAt: NOVEMBER_15,
      });

      expect(outcome).toEqual({ line: "kept", reportedGbMonths: 1 });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(meters.events).toEqual([
        {
          eventName: RETENTION_STORAGE_METER_EVENT_NAME,
          customerId: "cus_1",
          value: "1.000000",
          identifier: `retention-storage:${ORGANIZATION_ID}:2026-11-15`,
          timestamp: Math.floor(NOVEMBER_15 / 1000),
        },
      ]);
    });
  });

  describe("when the same day is reported twice", () => {
    /** @scenario "The same day is reported only once" */
    it("lets the meter refuse the duplicate and counts it as reported", async () => {
      const { service, meters } = setup({ held: subscription({ withStorage: true }) });
      const report = {
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
        bytesAboveIncluded: 30e9,
        measuredAt: NOVEMBER_15,
      };

      await service.record(report);
      const again = await service.record(report);

      expect(again.reportedGbMonths).toBe(1);
      expect(meters.events).toHaveLength(1);
    });
  });

  describe("when a running subscription has no storage line and the retention grows", () => {
    /** @scenario "A longer retention adds the storage line to a running subscription" */
    it("adds the storage price for the subscription's currency and interval", async () => {
      const { service, stripeSubscriptions } = setup({ held: subscription({ interval: "year" }) });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
      });

      expect(outcome).toEqual({ line: "added", reportedGbMonths: null });
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_1",
          change: { items: [{ price: "price_storage_eur_annual" }], prorationBehavior: "none" },
        },
      ]);
    });
  });

  describe("when the longest retention goes back to 90 days", () => {
    /** @scenario "Going back to 90 days removes the storage line" */
    it("removes the storage line without proration", async () => {
      const { service, stripeSubscriptions, meters } = setup({
        held: subscription({ withStorage: true }),
      });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 91,
        bytesAboveIncluded: 30e9,
      });

      expect(outcome).toEqual({ line: "removed", reportedGbMonths: null });
      expect(stripeSubscriptions.updates).toEqual([
        {
          subscriptionId: "sub_1",
          change: { items: [{ id: "si_storage", deleted: true }], prorationBehavior: "none" },
        },
      ]);
      expect(meters.events).toEqual([]);
    });
  });

  describe("when the retention keeps data forever", () => {
    it("bills the storage like any retention above 90 days", async () => {
      const { service } = setup();

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 0,
      });

      expect(outcome.line).toBe("added");
    });
  });

  describe("when the storage prices are not provisioned in this Stripe mode", () => {
    /** @scenario "A missing storage price leaves the subscription alone" */
    it("changes nothing and reports nothing", async () => {
      const { service, stripeSubscriptions, meters } = setup({
        servicePrices: { GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly" } as StripePriceMap,
      });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
        bytesAboveIncluded: 30e9,
      });

      expect(outcome).toEqual({ line: "skipped", reportedGbMonths: null });
      expect(stripeSubscriptions.updates).toEqual([]);
      expect(meters.events).toEqual([]);
    });
  });

  describe("when the storage meter is not provisioned in this Stripe mode", () => {
    it("keeps the line but reports nothing", async () => {
      const { service, meters } = setup({
        held: subscription({ withStorage: true }),
        isMeterProvisioned: false,
      });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
        bytesAboveIncluded: 30e9,
      });

      expect(outcome).toEqual({ line: "kept", reportedGbMonths: null });
      expect(meters.events).toEqual([]);
    });
  });

  describe("when the organization has no live Growth seat subscription", () => {
    /** @scenario "An organization without a live Growth seat subscription is not billed" */
    it("skips it without reading Stripe", async () => {
      const { service, stripeSubscriptions } = setup({ candidates: noCandidate() });

      const outcome = await service.record({
        organizationId: ORGANIZATION_ID,
        longestRetentionDays: 182,
        bytesAboveIncluded: 30e9,
      });

      expect(outcome).toEqual({ line: "skipped", reportedGbMonths: null });
      expect(stripeSubscriptions.reads).toEqual([]);
    });
  });
});
