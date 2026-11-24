/**
 * The price on the pricing page is the price in the code.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_PUBLISHED_RATES,
  instantEvalPriceUsd,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

const DOCS = "../../../../../../docs/";
const PRICING_PAGE = fileURLToPath(new URL(`${DOCS}pricing.mdx`, import.meta.url));
const COST_PAGE = fileURLToPath(
  new URL(`${DOCS}features/instant-evals/limits-and-cost.mdx`, import.meta.url),
);

/** Today's Instant Evals price for a million input tokens: no rated tokens, so cost times 1.3. */
const instantPrice = instantEvalPriceUsd({
  costUsd: INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
});
const { instant, evals } = INSTANT_EVAL_PUBLISHED_RATES;
/** The judge picker's name for Evals Preview, the LLM judge router. */
const ROUTER = "LangWatch Evals (preview)";

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One line that names the router and then its rate, so the rate cannot drift to another model. */
function modelAtRate({ model, rate }: { model: string; rate: string }): RegExp {
  return new RegExp(`${escaped(model)}[^\\n]*${escaped(rate)} per million input tokens`);
}

describe("given the classifier's rate and markup, and the Evals tier's published rate", () => {
  describe("when the pricing page is read", () => {
    /** @scenario "The pricing page states today's Instant Evals price and the judge router's rate, before VAT" */
    it("states the Instant Evals price, the judge router's rate and its floor, before VAT", () => {
      const page = readFileSync(PRICING_PAGE, "utf8");

      expect(page).toContain("## Instant Evals");
      expect(page).toContain(`$${instantPrice.toFixed(4)} per million input tokens`);
      expect(page).toMatch(modelAtRate({ model: ROUTER, rate: `$${evals.toFixed(2)}` }));
      expect(page).not.toContain(`$${instant.toFixed(2)} per million`);
      expect(page).toContain("excluding VAT");
      expect(page).toContain(`${INSTANT_EVAL_PRICING.markup} times`);
    });
  });

  describe("when the Instant Evals cost page is read", () => {
    /** @scenario "The pricing page states today's Instant Evals price and the judge router's rate, before VAT" */
    it("states the Instant Evals price, the judge router's rate and its floor, before VAT", () => {
      const page = readFileSync(COST_PAGE, "utf8");

      expect(page).toContain(`${instantPrice.toFixed(4)} USD per million input tokens`);
      expect(page).toMatch(modelAtRate({ model: ROUTER, rate: `${evals.toFixed(2)} USD` }));
      expect(page).not.toContain(`${instant.toFixed(2)} USD per million`);
      expect(page).toContain("excluding VAT");
      expect(page).toContain(`${INSTANT_EVAL_PRICING.markup} times`);
    });
  });
});
