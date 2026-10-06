import { NANO_USD_PER_USD } from "@langwatch/gateway-contract";
import { estimateModelCost, getStaticModelCostRates } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";
import { ModelCatalogGatewaySpendRatingService } from "../../services/model-catalog-gateway-spend-rating.service.ts";

const spendRating = ModelCatalogGatewaySpendRatingService.create();
const MODEL = "anthropic/claude-sonnet-4.5";
const FRESH_INPUT = 200;
const CACHED_INPUT = 9_000;
const OUTPUT = 150;

describe("cache spend pricing", () => {
  describe("given one cached request's usage as the gateway measured it", () => {
    describe("when the trace surface and the spend surface each price it", () => {
      /** @scenario The trace and the bill price a cached request at the same number */
      it("arrives at one cost, and an input count holding the cached tokens costs more", () => {
        const spend = spendRating.rateSpendNanoUsd({
          model: MODEL,
          usage: {
            ...EMPTY_SPEND_USAGE,
            input_tokens: FRESH_INPUT,
            output_tokens: OUTPUT,
            cache_read_input_tokens: CACHED_INPUT,
          },
        }).costNanoUsd;

        const spanUsd = estimateModelCost(
          {
            attrs: {
              "gen_ai.operation.name": "chat",
              "gen_ai.request.model": MODEL,
              "gen_ai.usage.cache_read.input_tokens": CACHED_INPUT,
            },
            promptTokens: FRESH_INPUT,
            completionTokens: OUTPUT,
          },
          getStaticModelCostRates(),
        );
        const traceNano = Math.round(spanUsd * NANO_USD_PER_USD);

        const doubleCounted = spendRating.rateSpendNanoUsd({
          model: MODEL,
          usage: {
            ...EMPTY_SPEND_USAGE,
            input_tokens: FRESH_INPUT + CACHED_INPUT,
            output_tokens: OUTPUT,
            cache_read_input_tokens: CACHED_INPUT,
          },
        }).costNanoUsd;

        expect(spend).toBeGreaterThan(0);
        expect(traceNano).toBe(spend);
        expect(doubleCounted).toBeGreaterThan(spend);
        expect(doubleCounted).toBeGreaterThan(traceNano);
      });
    });
  });
});
