/**
 * Whether a customer's subscriptions price a meter, the check PII and Instant Evals share.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import type { BillingSubscription } from "../billing-stripe-shapes.rules.ts";
import { carriesPrice } from "../subscription-price.rules.ts";

const PII_PRICE = "price_pii";
const INSTANT_EVAL_PRICE = "price_instant_eval_usd";

function subscription(
  status: BillingSubscription["status"],
  priceIds: string[],
): BillingSubscription {
  return {
    id: `sub_${status}`,
    status,
    canceledAt: null,
    billingThreshold: null,
    items: priceIds.map((priceId, index) => ({
      id: `si_${index}`,
      priceId,
      unitAmount: null,
      interval: "month",
      quantity: null,
    })),
  };
}

describe("carriesPrice", () => {
  describe("when an invoiced subscription has a line on the price", () => {
    it.each(["active", "past_due", "trialing"] as const)("holds for a %s one", (status) => {
      expect(
        carriesPrice({
          subscriptions: [subscription(status, ["price_seat", PII_PRICE])],
          priceId: PII_PRICE,
        }),
      ).toBe(true);
    });
  });

  describe("when no subscription has a line on the price", () => {
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("does not hold", () => {
      expect(
        carriesPrice({
          subscriptions: [subscription("active", ["price_seat", "price_events"])],
          priceId: PII_PRICE,
        }),
      ).toBe(false);
    });

    /** @scenario "A Growth subscription in euros holds its Instant Eval usage" */
    it("does not hold for a euro subscription asked for the dollar Instant Evals price", () => {
      expect(
        carriesPrice({
          subscriptions: [subscription("active", ["price_seat_eur", "price_events_eur"])],
          priceId: INSTANT_EVAL_PRICE,
        }),
      ).toBe(false);
    });
  });

  describe("when only an ended subscription has the line", () => {
    it.each(["canceled", "incomplete_expired", "unpaid", "paused"] as const)(
      "does not hold for a %s one, which invoices nothing",
      (status) => {
        expect(
          carriesPrice({
            subscriptions: [subscription(status, [PII_PRICE])],
            priceId: PII_PRICE,
          }),
        ).toBe(false);
      },
    );
  });

  describe("when the mode maps no PII redaction price", () => {
    it("does not hold, whatever the subscriptions carry", () => {
      expect(
        carriesPrice({
          subscriptions: [subscription("active", [PII_PRICE])],
          priceId: undefined,
        }),
      ).toBe(false);
    });
  });
});
