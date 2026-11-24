/**
 * The price on the pricing page is the price in the code.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INSTANT_EVAL_PRICING,
  INSTANT_EVAL_PUBLISHED_RATES,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

const DOCS = "../../../../../../docs/";
const PRICING_PAGE = fileURLToPath(new URL(`${DOCS}pricing.mdx`, import.meta.url));
const COST_PAGE = fileURLToPath(
  new URL(`${DOCS}features/instant-evals/limits-and-cost.mdx`, import.meta.url),
);

const { instant, evals } = INSTANT_EVAL_PUBLISHED_RATES;

/** One line that names the model and then its rate, so a rate cannot drift to the other model. */
function modelAtRate({ model, rate }: { model: string; rate: string }): RegExp {
  return new RegExp(`${model}[^\\n]*${rate.replace(/[$.]/g, "\\$&")} per million input tokens`);
}

describe("given the Instant tier's and the Evals tier's published rates", () => {
  describe("when the pricing page is read", () => {
    /** @scenario "The pricing page states the published rates before VAT" */
    it("states each model's rate per million input tokens, before VAT, with the cost floor", () => {
      const page = readFileSync(PRICING_PAGE, "utf8");

      expect(page).toContain("## Instant Evals");
      expect(page).toMatch(
        modelAtRate({ model: "Instant Preview", rate: `$${instant.toFixed(2)}` }),
      );
      expect(page).toMatch(modelAtRate({ model: "Evals Preview", rate: `$${evals.toFixed(2)}` }));
      expect(page).toContain("excluding VAT");
      expect(page).toContain(`${INSTANT_EVAL_PRICING.markup} times`);
    });
  });

  describe("when the Instant Evals cost page is read", () => {
    /** @scenario "The pricing page states the published rates before VAT" */
    it("states each model's rate per million input tokens, before VAT, with the cost floor", () => {
      const page = readFileSync(COST_PAGE, "utf8");

      expect(page).toMatch(
        modelAtRate({ model: "Instant Preview", rate: `${instant.toFixed(2)} USD` }),
      );
      expect(page).toMatch(
        modelAtRate({ model: "Evals Preview", rate: `${evals.toFixed(2)} USD` }),
      );
      expect(page).toContain("excluding VAT");
      expect(page).toContain(`${INSTANT_EVAL_PRICING.markup} times`);
    });
  });
});
