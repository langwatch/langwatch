/**
 * Whether a customer's subscriptions price a meter, the check PII and Instant Evals share
 * (ADR-174 decision 18).
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { describe, expect, it } from "vitest";

import type {
  BillingSubscription,
  BillingSubscriptionItem,
} from "../billing-stripe-shapes.rules.ts";
import { carriesPrice } from "../subscription-price.rules.ts";

const PRICE_NAME = "GROWTH_INSTANT_EVAL_USD";
const PRICE_ID = "price_catalogue";

type Line = string | Partial<BillingSubscriptionItem>;

function subscription(status: BillingSubscription["status"], lines: Line[]): BillingSubscription {
  return {
    id: `sub_${status}`,
    status,
    canceledAt: null,
    billingThreshold: null,
    items: lines.map((line, index) => ({
      id: `si_${index}`,
      priceId: typeof line === "string" ? line : `price_other_${index}`,
      unitAmount: null,
      interval: "month",
      quantity: null,
      ...(typeof line === "string" ? {} : line),
    })),
  };
}

const carries = (subscriptions: BillingSubscription[]) =>
  carriesPrice({ subscriptions, priceName: PRICE_NAME, priceId: PRICE_ID });

describe("carriesPrice", () => {
  describe("when an invoiced subscription has a line on the price", () => {
    it.each(["active", "past_due", "trialing"] as const)("holds for a %s one", (status) => {
      expect(carries([subscription(status, ["price_seat", PRICE_ID])])).toBe(true);
    });
  });

  describe("when no subscription has a line on the price", () => {
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("does not hold", () => {
      expect(carries([subscription("active", ["price_seat", "price_events"])])).toBe(false);
    });
  });

  describe("when the line is on a newer price for the same name", () => {
    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("holds when that price carries the name as its lookup key", () => {
      expect(
        carries([subscription("active", [{ priceId: "price_new", lookupKey: PRICE_NAME }])]),
      ).toBe(true);
    });

    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("holds when the old price kept the name in its langwatch_key metadata", () => {
      expect(
        carries([
          subscription("active", [
            { priceId: "price_old", lookupKey: null, langwatchKey: PRICE_NAME },
          ]),
        ]),
      ).toBe(true);
    });

    /** @scenario "A re-priced Instant Evals line is still recognised" */
    it("does not hold for a price keyed to another name", () => {
      expect(
        carries([
          subscription("active", [
            {
              priceId: "price_pii",
              lookupKey: "GROWTH_PII_REDACTION_USD",
              langwatchKey: "GROWTH_PII_REDACTION_USD",
            },
          ]),
        ]),
      ).toBe(false);
    });
  });

  describe("when only an ended subscription has the line", () => {
    it.each(["canceled", "incomplete_expired", "unpaid", "paused"] as const)(
      "does not hold for a %s one, which invoices nothing",
      (status) => {
        expect(carries([subscription(status, [PRICE_ID])])).toBe(false);
      },
    );
  });

  describe("when the mode maps no price for the name", () => {
    it("does not hold, whatever the subscriptions carry", () => {
      expect(
        carriesPrice({
          subscriptions: [
            subscription("active", [{ priceId: "price_new", lookupKey: PRICE_NAME }]),
          ],
          priceName: PRICE_NAME,
          priceId: undefined,
        }),
      ).toBe(false);
    });
  });
});
