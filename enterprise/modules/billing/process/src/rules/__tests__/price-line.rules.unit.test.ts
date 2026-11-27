/**
 * Whether a customer's subscriptions price a usage meter, and the moment its month is billed
 * from (ADR-174 decisions 18 and 26).
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 * @see enterprise/modules/billing/specs/euro-usage-prices.feature
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
const ON_THE_6TH_MS = Date.UTC(2026, 1, 6, 10);
const ON_THE_10TH_MS = Date.UTC(2026, 1, 10, 9);
const ON_THE_15TH_MS = Date.UTC(2026, 1, 15, 12);
const ON_THE_20TH_MS = Date.UTC(2026, 1, 20, 8);
/** The replacement tolerance is one minute: pinned as instants, not read off the constant. */
const ONE_MINUTE_BEFORE_THE_15TH_MS = Date.UTC(2026, 1, 15, 11, 59);
const JUST_OVER_A_MINUTE_BEFORE_THE_15TH_MS = Date.UTC(2026, 1, 15, 11, 58, 59);

function line(
  createdAtMs: number,
  overrides: Partial<BillingSubscriptionItem> = {},
): BillingSubscriptionItem {
  return {
    id: `si_${overrides.priceId ?? PRICE_ID}_${createdAtMs}`,
    priceId: PRICE_ID,
    unitAmount: null,
    interval: "month",
    quantity: null,
    createdAt: seconds(createdAtMs),
    ...overrides,
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

const since = (ms: number) => ({ carried: true, addedAtMs: seconds(ms) * 1000 });

describe("priceLineOf", () => {
  describe("when an invoiced subscription has a line on the price", () => {
    it.each(["active", "past_due", "trialing"] as const)("carries it for a %s one", (status) => {
      expect(
        lineOf([
          subscription({
            status,
            items: [line(ON_THE_10TH_MS, { priceId: "price_seat" }), line(ON_THE_10TH_MS)],
          }),
        ]),
      ).toEqual(since(ON_THE_10TH_MS));
    });
  });

  describe("when no invoiced subscription has a line on the price", () => {
    /** @scenario "Without the line nothing is read as billed" */
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("answers that the price is not carried", () => {
      expect(
        lineOf([
          subscription({
            items: [
              line(ON_THE_10TH_MS, { priceId: "price_seat" }),
              line(ON_THE_10TH_MS, { priceId: "price_events" }),
            ],
          }),
        ]),
      ).toEqual({ carried: false });
    });

    /** @scenario "Without the line nothing is read as billed" */
    it.each(["canceled", "incomplete_expired", "unpaid", "paused"] as const)(
      "answers not carried when only a %s subscription, which invoices nothing, has it",
      (status) => {
        expect(lineOf([subscription({ status, items: [line(BEFORE_THE_MONTH_MS)] })])).toEqual({
          carried: false,
        });
      },
    );

    it("answers not carried where the mode maps no price for the name", () => {
      expect(
        priceLineOf({
          subscriptions: [
            subscription({
              items: [line(ON_THE_10TH_MS, { priceId: "price_new", lookupKey: PRICE_NAME })],
            }),
          ],
          prices: [{ priceName: PRICE_NAME, priceId: undefined }],
          billingMonth: BILLING_MONTH,
        }),
      ).toEqual({ carried: false });
    });
  });

  describe("when the line is on a newer price for the same name", () => {
    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("carries it when that price carries the name as its lookup key", () => {
      expect(
        lineOf([
          subscription({
            items: [line(ON_THE_10TH_MS, { priceId: "price_new", lookupKey: PRICE_NAME })],
          }),
        ]),
      ).toEqual(since(ON_THE_10TH_MS));
    });

    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("carries it when the old price kept the name in its langwatch_key metadata", () => {
      expect(
        lineOf([
          subscription({
            items: [
              line(ON_THE_10TH_MS, {
                priceId: "price_old",
                lookupKey: null,
                langwatchKey: PRICE_NAME,
              }),
            ],
          }),
        ]),
      ).toEqual(since(ON_THE_10TH_MS));
    });

    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("does not carry a price keyed to another name", () => {
      expect(
        lineOf([
          subscription({
            items: [
              line(ON_THE_10TH_MS, {
                priceId: "price_pii",
                lookupKey: "GROWTH_PII_REDACTION_USD",
                langwatchKey: "GROWTH_PII_REDACTION_USD",
              }),
            ],
          }),
        ]),
      ).toEqual({ carried: false });
    });
  });

  describe("when the live line was added mid-month", () => {
    /** @scenario "A PII redaction line added mid-month bills only from that moment" */
    it("answers the line's creation", () => {
      expect(lineOf([subscription({ items: [line(ON_THE_10TH_MS)] })])).toEqual(
        since(ON_THE_10TH_MS),
      );
    });
  });

  describe("when the line was removed and a new one added", () => {
    /** @scenario "A line removed and added again bills from the line now on the subscription" */
    it("answers the new line's creation, since Stripe lists only the line now there", () => {
      expect(lineOf([subscription({ items: [line(ON_THE_20TH_MS)] })])).toEqual(
        since(ON_THE_20TH_MS),
      );
    });
  });

  describe("when a subscription carrying the line was replaced mid-month", () => {
    /** @scenario "A subscription replaced mid-month keeps the earlier line's start" */
    it("answers the cancelled subscription's earlier line when it ended as the new line began", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ON_THE_15TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual(since(BEFORE_THE_MONTH_MS));
    });

    /** @scenario "A subscription replaced mid-month keeps the earlier line's start" */
    it("still chains a cancellation that landed within the tolerance before the new line", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ONE_MINUTE_BEFORE_THE_15TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual(since(BEFORE_THE_MONTH_MS));
    });

    /** @scenario "A subscription replaced mid-month keeps the earlier line's start" */
    it("chains every replacement back to the first line", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ON_THE_10TH_MS,
          }),
          subscription({
            status: "canceled",
            items: [line(ON_THE_10TH_MS)],
            endedAtMs: ON_THE_15TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual(since(BEFORE_THE_MONTH_MS));
    });
  });

  describe("when no line existed between a cancelled subscription's end and the new line", () => {
    /** @scenario "Usage while no line existed anywhere is never billed" */
    it("answers the new line's creation, so the gap is never billed", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: ON_THE_6TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual(since(ON_THE_15TH_MS));
    });

    /** @scenario "Usage while no line existed anywhere is never billed" */
    it("does not chain a cancellation just past the tolerance", () => {
      expect(
        lineOf([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS)],
            endedAtMs: JUST_OVER_A_MINUTE_BEFORE_THE_15TH_MS,
          }),
          subscription({ items: [line(ON_THE_15TH_MS)] }),
        ]),
      ).toEqual(since(ON_THE_15TH_MS));
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
      ).toEqual(since(ON_THE_10TH_MS));
    });
  });

  describe("when the line carries no creation time", () => {
    /** @scenario "A line with no recorded creation is refused as a failed read" */
    it("refuses rather than read the month from before the line", () => {
      expect(() =>
        lineOf([subscription({ items: [line(ON_THE_10TH_MS, { createdAt: Number.NaN })] })]),
      ).toThrow(/has no creation time/);
    });
  });

  describe("when the line is on another of the meter's prices", () => {
    it("answers that line's creation", () => {
      expect(
        priceLineOf({
          subscriptions: [
            subscription({ items: [line(ON_THE_10TH_MS, { priceId: "price_other" })] }),
          ],
          prices: [...PRICES, { priceName: "GROWTH_INSTANT_EVAL_OTHER", priceId: "price_other" }],
          billingMonth: BILLING_MONTH,
        }),
      ).toEqual(since(ON_THE_10TH_MS));
    });
  });
});

describe("priceLineOf, given a meter priced in two currencies", () => {
  const instantEvalPrices = [
    { priceName: "GROWTH_INSTANT_EVAL_USD", priceId: "price_instant_eval_usd" },
    { priceName: "GROWTH_INSTANT_EVAL_EUR", priceId: "price_instant_eval_eur" },
  ];
  const lineOfEither = (subscriptions: BillingSubscription[]) =>
    priceLineOf({ subscriptions, prices: instantEvalPrices, billingMonth: BILLING_MONTH });

  describe("when one listed subscription has a line on the euro price", () => {
    /** @scenario "A line on either currency's price counts as the meter's price" */
    it.each([
      ["its id", { priceId: "price_instant_eval_eur" }],
      ["its lookup key", { priceId: "price_eur_new", lookupKey: "GROWTH_INSTANT_EVAL_EUR" }],
      ["its langwatch_key", { priceId: "price_eur_old", langwatchKey: "GROWTH_INSTANT_EVAL_EUR" }],
    ] as const)("carries it from that line's date, found by %s", (_how, overrides) => {
      expect(
        lineOfEither([
          subscription({
            status: "canceled",
            items: [line(BEFORE_THE_MONTH_MS, { priceId: "price_seat_usd" })],
            endedAtMs: ON_THE_6TH_MS,
          }),
          subscription({
            items: [
              line(ON_THE_10TH_MS, { priceId: "price_seat_eur" }),
              line(ON_THE_10TH_MS, overrides),
            ],
          }),
        ]),
      ).toEqual(since(ON_THE_10TH_MS));
    });
  });

  describe("when no subscription has a line on either price", () => {
    /** @scenario "A line on either currency's price counts as the meter's price" */
    it("carries nothing", () => {
      expect(
        lineOfEither([
          subscription({
            items: [
              line(ON_THE_10TH_MS, { priceId: "price_seat_eur" }),
              line(ON_THE_10TH_MS, { priceId: "price_events_eur" }),
            ],
          }),
        ]),
      ).toEqual({ carried: false });
    });
  });

  describe("when the mode maps neither price", () => {
    /** @scenario "A line on either currency's price counts as the meter's price" */
    it("carries nothing, whatever the subscriptions carry", () => {
      expect(
        priceLineOf({
          subscriptions: [
            subscription({
              items: [
                line(ON_THE_10TH_MS, { priceId: "price_x", lookupKey: "GROWTH_INSTANT_EVAL_EUR" }),
              ],
            }),
          ],
          prices: instantEvalPrices.map(({ priceName }) => ({ priceName, priceId: undefined })),
          billingMonth: BILLING_MONTH,
        }),
      ).toEqual({ carried: false });
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

  /** @scenario "The month starts at the later of the subscription's start and the line's" */
  it("keeps whichever start is known, and the whole month when neither is", () => {
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
