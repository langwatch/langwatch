/**
 * The storage line a Growth checkout carries when the picked retention is above the 90 days
 * Growth includes, and the daily share the meter receives.
 * @see specs/billing/retention-storage-billing.feature
 */

import { describe, expect, it } from "vitest";

import {
  createCheckoutLineItems,
  dailyGbMonthShare,
  pickRetentionStoragePriceId,
  retentionBillsStorage,
  type StripePriceMap,
} from "../index.ts";

const prices = {
  GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
  GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
  GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
  GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
  RETENTION_STORAGE_EUR_ANNUAL: "price_storage_eur_annual",
  RETENTION_STORAGE_USD_MONTHLY: "price_storage_usd_monthly",
} as StripePriceMap;

describe("createCheckoutLineItems() with a retention", () => {
  describe("when the retention is above 90 days", () => {
    /** @scenario "A checkout with a retention above 90 days adds the storage line" */
    it("adds the metered storage price for the currency and interval", () => {
      expect(
        createCheckoutLineItems({
          coreMembers: 3,
          currency: "EUR",
          interval: "annual",
          prices,
          retentionDays: 182,
        }),
      ).toEqual([
        { price: "price_seat_eur_annual", quantity: 3 },
        { price: "price_events_eur_annual" },
        { price: "price_storage_eur_annual" },
      ]);
    });
  });

  describe("when the retention is 90 days or less", () => {
    /** @scenario "A checkout at 90 days or less has no storage line" */
    it("holds no storage line", () => {
      expect(
        createCheckoutLineItems({
          coreMembers: 2,
          currency: "USD",
          interval: "monthly",
          prices,
          retentionDays: 91,
        }),
      ).toEqual([
        { price: "price_seat_usd_monthly", quantity: 2 },
        { price: "price_events_usd_monthly" },
      ]);
    });
  });

  describe("when the storage price is not provisioned in this mode", () => {
    it("still builds the checkout without it", () => {
      expect(
        createCheckoutLineItems({
          coreMembers: 2,
          currency: "USD",
          interval: "monthly",
          prices: { ...prices, RETENTION_STORAGE_USD_MONTHLY: undefined } as StripePriceMap,
          retentionDays: 371,
        }),
      ).toEqual([
        { price: "price_seat_usd_monthly", quantity: 2 },
        { price: "price_events_usd_monthly" },
      ]);
    });
  });
});

describe("retentionBillsStorage()", () => {
  it("bills only above the 91 days Growth keeps", () => {
    expect(retentionBillsStorage(91)).toBe(false);
    expect(retentionBillsStorage(182)).toBe(true);
    expect(retentionBillsStorage(undefined)).toBe(false);
  });
});

describe("pickRetentionStoragePriceId()", () => {
  it("answers the price for the currency and interval, or nothing", () => {
    expect(pickRetentionStoragePriceId({ currency: "USD", interval: "monthly", prices })).toBe(
      "price_storage_usd_monthly",
    );
    expect(
      pickRetentionStoragePriceId({ currency: "USD", interval: "annual", prices }),
    ).toBeUndefined();
  });
});

describe("dailyGbMonthShare()", () => {
  it("spreads the GB over the days of the month", () => {
    expect(dailyGbMonthShare({ bytes: 30e9, daysInMonth: 30 })).toBe(1);
  });
});
