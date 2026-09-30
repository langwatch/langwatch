/**
 * The price on the pricing page is the price in the code.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { INSTANT_EVAL_PRICING, instantEvalPriceUsd } from "../instant-eval-pricing.rules.ts";

const PRICING_PAGE = fileURLToPath(new URL("../../../../../../docs/pricing.mdx", import.meta.url));

describe("given the classifier's published rate and markup", () => {
  describe("when the pricing page is read", () => {
    /** @scenario "The pricing page states the shipped rate" */
    it("states the customer price per million input tokens those two produce", () => {
      const price = instantEvalPriceUsd({ costUsd: INSTANT_EVAL_PRICING.usdPerMillionInputTokens });
      const page = readFileSync(PRICING_PAGE, "utf8");

      expect(page).toContain("## Instant Evals");
      expect(page).toContain(`$${price.toFixed(4)} per million input tokens`);
    });
  });
});
