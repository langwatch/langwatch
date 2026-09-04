import { describe, expect, it } from "vitest";
import {
  estimateModelCost,
  getStaticModelCostRates,
} from "@langwatch/model-provider-contract";
import { EMPTY_SPEND_USAGE } from "../../processes/gateway-spend-commands.process";
import {
  NANO_USD_PER_USD,
  rateSpendNanoUsd,
} from "../model-catalog.gateway-spend-rating.adapter";

// Catalog rates under test (model-catalog.overlay.json), per token, from
// OpenAI's pricing page: gpt-image-1 $5 text in, $10 image in, $40 image out
// per million.
const IMAGE1_TEXT_IN = 5e-6;
const IMAGE1_IMAGE_IN = 1e-5;
const IMAGE1_IMAGE_OUT = 4e-5;

/** A 1024x1024 answer on gpt-image is about this many output image tokens. */
const ONE_SQUARE_IMAGE = 1600;

describe("image spend pricing", () => {
  describe("given the spend wire and a project that set a custom rule", () => {
    describe("when the request is rated", () => {
      /** @scenario the spend wire prices images from the catalog alone */
      it("prices both image buckets at the catalog rates", () => {
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "openai/gpt-image-1",
          usage: {
            ...EMPTY_SPEND_USAGE,
            input_tokens: 20,
            input_image_tokens: 323,
            output_image_tokens: ONE_SQUARE_IMAGE,
            image_count: 1,
          },
        });
        expect(costNanoUsd).toBe(
          Math.round(
            (20 * IMAGE1_TEXT_IN +
              323 * IMAGE1_IMAGE_IN +
              ONE_SQUARE_IMAGE * IMAGE1_IMAGE_OUT) *
              NANO_USD_PER_USD,
          ),
        );
      });
    });
  });

  describe("given the same image call on the trace and on the spend wire", () => {
    describe("when both are priced", () => {
      /** @scenario the trace span cost and the budget debit agree on an image call */
      it("states one figure on both surfaces", () => {
        const usage = {
          ...EMPTY_SPEND_USAGE,
          input_tokens: 14,
          input_image_tokens: 323,
          output_image_tokens: ONE_SQUARE_IMAGE,
          image_count: 1,
        };
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "openai/gpt-image-2",
          usage,
        });

        // The trace side of the comparison: the same cascade a span goes
        // through, which is the whole of `computeSpanCost` in the trace
        // feature. Naming it here keeps the two surfaces comparable without
        // this package depending on that one.
        const spanUsd = estimateModelCost(
          {
            attrs: {
              "gen_ai.operation.name": "image_edit",
              "gen_ai.request.model": "openai/gpt-image-2",
              "gen_ai.usage.input_image_tokens": usage.input_image_tokens,
              "gen_ai.usage.output_image_tokens": usage.output_image_tokens,
              "gen_ai.usage.image_count": usage.image_count,
            },
            promptTokens: usage.input_tokens,
            completionTokens: usage.output_tokens,
          },
          getStaticModelCostRates(),
        );

        expect(Math.round(spanUsd * NANO_USD_PER_USD)).toBe(costNanoUsd);
        expect(costNanoUsd).toBeGreaterThan(0);
      });
    });
  });
});
