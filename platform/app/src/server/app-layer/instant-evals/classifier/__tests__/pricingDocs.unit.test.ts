/**
 * The price on the pricing page is the price in the code.
 *
 * The page states one number, the customer price per million input tokens,
 * and that number is the published rate times the markup. A change to either
 * constant fails here until the page says the new number.
 *
 * @see ../pricing.ts
 * @see docs/pricing.mdx
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_PRICING, instantEvalPriceUsd } from "../pricing";

const PRICING_PAGE = resolve(
  __dirname,
  "../../../../../../../../docs/pricing.mdx",
);

/** The customer price per million input tokens, as the page prints it. */
function customerPricePerMillion(): string {
  const price = instantEvalPriceUsd({
    costUsd: INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
  });
  // Four places is what the shipped rate needs and what the page prints;
  // a rate that needs more would change this test with the page.
  return price.toFixed(4);
}

describe("given the classifier's published rate and markup", () => {
  describe("when the pricing page is read", () => {
    /** @scenario "The pricing page states the shipped rate" */
    it("states the customer price per million input tokens those two produce", () => {
      const page = readFileSync(PRICING_PAGE, "utf8");
      const price = customerPricePerMillion();

      expect(page).toContain("## Instant Evals");
      expect(page).toContain(`$${price} per million input tokens`);
    });

    it("states the shipped number, so a silent rate change is caught here", () => {
      expect(customerPricePerMillion()).toBe("0.0546");
    });
  });
});
