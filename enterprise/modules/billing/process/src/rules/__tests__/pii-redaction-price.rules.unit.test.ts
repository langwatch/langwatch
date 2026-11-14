/**
 * Whether a customer's subscriptions price the PII redaction meter.
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { describe, expect, it } from "vitest";

import type { BillingSubscription } from "../billing-stripe-shapes.rules.ts";
import { carriesPiiRedactionPrice } from "../pii-redaction-meter.rules.ts";

const PII_PRICE = "price_pii";

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

describe("carriesPiiRedactionPrice", () => {
  describe("when an invoiced subscription has a line on the price", () => {
    it.each(["active", "past_due", "trialing"] as const)("holds for a %s one", (status) => {
      expect(
        carriesPiiRedactionPrice({
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
        carriesPiiRedactionPrice({
          subscriptions: [subscription("active", ["price_seat", "price_events"])],
          priceId: PII_PRICE,
        }),
      ).toBe(false);
    });
  });

  describe("when only an ended subscription has the line", () => {
    it.each(["canceled", "incomplete_expired", "unpaid", "paused"] as const)(
      "does not hold for a %s one, which invoices nothing",
      (status) => {
        expect(
          carriesPiiRedactionPrice({
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
        carriesPiiRedactionPrice({
          subscriptions: [subscription("active", [PII_PRICE])],
          priceId: undefined,
        }),
      ).toBe(false);
    });
  });
});
