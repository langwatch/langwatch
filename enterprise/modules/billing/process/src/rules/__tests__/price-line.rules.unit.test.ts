/**
 * When a usage meter's price line was added, the moment its month is billed from (ADR-174
 * decision 26).
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 */

import { describe, expect, it } from "vitest";

import type {
  BillingSubscription,
  BillingSubscriptionItem,
} from "../billing-stripe-shapes.rules.ts";
import { meterBilledSince, priceLineOf } from "../price-line.rules.ts";

const PRICE_NAME = "GROWTH_INSTANT_EVAL_USD";
const PRICE_ID = "price_catalogue";
const PRICES = [{ priceName: PRICE_NAME, priceId: PRICE_ID }];
const BILLING_MONTH = "2026-02";

const seconds = (ms: number) => Math.floor(ms / 1000);
const BEFORE_THE_MONTH_MS = Date.UTC(2026, 0, 20);
const ON_THE_10TH_MS = Date.UTC(2026, 1, 10, 9);
const ON_THE_15TH_MS = Date.UTC(2026, 1, 15, 12);
const ON_THE_20TH_MS = Date.UTC(2026, 1, 20, 8);

function line(createdAtMs: number | null, priceId = PRICE_ID): BillingSubscriptionItem {
  return {
    id: `si_${priceId}_${createdAtMs}`,
    priceId,
    unitAmount: null,
    interval: "month",
    quantity: null,
    ...(createdAtMs === null ? {} : { createdAt: seconds(createdAtMs) }),
  };
}

function subscription({
  status = "active",
  items,
  endedAtMs,
}: {
  status?: BillingSubscription["status"];
  items: BillingSubscriptionItem[];
  endedAtMs?: number;
}): BillingSubscription {
  return {
    id: `sub_${status}_${endedAtMs ?? "live"}`,
    status,
    canceledAt: endedAtMs === undefined ? null : seconds(endedAtMs),
    billingThreshold: null,
    items,
    ...(endedAtMs === undefined ? {} : { endedAt: seconds(endedAtMs) }),
  };
}

const lineOf = (subscriptions: BillingSubscription[]) =>
  priceLineOf({ subscriptions, prices: PRICES, billingMonth: BILLING_MONTH });

describe("priceLineOf", () => {
  describe("when no invoiced subscription has a line on the price", () => {
    /** @scenario "Without the line nothing is read as billed" */
    it("answers that the price is not carried", () => {
      expect(lineOf([subscription({ items: [line(ON_THE_10TH_MS, "price_seat")] })])).toEqual({
        carried: false,
      });
    });

    /** @scenario "Without the line nothing is read as billed" */
    it("answers not carried when only a cancelled subscription has the line", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ON_THE_15TH_MS,
          }),
        ]),
      ).toEqual({ carried: false });
    });
  });

  describe("when the live line was added mid-month", () => {
    /** @scenario "A PII redaction line added mid-month bills only from that moment" */
    it("answers the line's creation", () => {
      expect(lineOf([subscription({ items: [line(ON_THE_10TH_MS)] })])).toEqual({
        carried: true,
        addedAtMs: seconds(ON_THE_10TH_MS) * 1000,
      });
    });
  });

  describe("when the line was removed and a new one added", () => {
    /** @scenario "A line removed and added again bills from the line now on the subscription" */
    it("answers the new line's creation, since Stripe lists only the line now there", () => {
      expect(lineOf([subscription({ items: [line(ON_THE_20TH_MS)] })])).toEqual({
        carried: true,
        addedAtMs: seconds(ON_THE_20TH_MS) * 1000,
      });
    });
  });

  describe("when a subscription carrying the line was replaced mid-month", () => {
    /** @scenario "A subscription replaced mid-month keeps the earlier line's start" */
    it("answers the cancelled subscription's earlier line", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ON_THE_15TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual({ carried: true, addedAtMs: seconds(BEFORE_THE_MONTH_MS) * 1000 });
    });
  });

  describe("when a subscription carrying the line ended before the month", () => {
    /** @scenario "A line on a subscription that ended before the month does not set its start" */
    it("answers the live line's creation", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(Date.UTC(2025, 11, 1))],
            endedAtMs: Date.UTC(2026, 1, 1),
          }),
          subscription({ items: [line(ON_THE_10TH_MS)] }),
        ]),
      ).toEqual({ carried: true, addedAtMs: seconds(ON_THE_10TH_MS) * 1000 });
    });
  });

  describe("when the line carries no creation time", () => {
    /** @scenario "A line with no recorded creation reads the month as before" */
    it("answers no start", () => {
      expect(lineOf([subscription({ items: [line(null)] })])).toEqual({
        carried: true,
        addedAtMs: null,
      });
    });
  });

  describe("when the line is on another of the meter's prices", () => {
    it("answers that line's creation", () => {
      expect(
        priceLineOf({
          subscriptions: [subscription({ items: [line(ON_THE_10TH_MS, "price_other")] })],
          prices: [...PRICES, { priceName: "GROWTH_INSTANT_EVAL_OTHER", priceId: "price_other" }],
          billingMonth: BILLING_MONTH,
        }),
      ).toEqual({ carried: true, addedAtMs: seconds(ON_THE_10TH_MS) * 1000 });
    });
  });
});

describe("meterBilledSince", () => {
  /** @scenario "The month starts at the later of the subscription's start and the line's" */
  it("takes the later of the subscription's start and the line's", () => {
    expect(
      meterBilledSince({
        usageBilledSinceMs: Date.UTC(2026, 1, 3),
        lineAddedAtMs: ON_THE_10TH_MS,
      }),
    ).toEqual({ outcome: "since", startMs: ON_THE_10TH_MS });
    expect(
      meterBilledSince({ usageBilledSinceMs: ON_THE_15TH_MS, lineAddedAtMs: ON_THE_10TH_MS }),
    ).toEqual({ outcome: "since", startMs: ON_THE_15TH_MS });
  });

  /** @scenario "A line with no recorded creation reads the month as before" */
  it("keeps whichever start is known, and none when neither is", () => {
    expect(meterBilledSince({ usageBilledSinceMs: null, lineAddedAtMs: ON_THE_10TH_MS })).toEqual({
      outcome: "since",
      startMs: ON_THE_10TH_MS,
    });
    expect(meterBilledSince({ usageBilledSinceMs: ON_THE_15TH_MS, lineAddedAtMs: null })).toEqual({
      outcome: "since",
      startMs: ON_THE_15TH_MS,
    });
    expect(meterBilledSince({ usageBilledSinceMs: null, lineAddedAtMs: null })).toEqual({
      outcome: "whole_month",
    });
  });
});
