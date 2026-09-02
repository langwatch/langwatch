import { describe, expect, it } from "vitest";
import { EMPTY_SPEND_USAGE } from "../../../event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import {
  NANO_USD_PER_USD,
  rateSpendNanoUsd,
} from "../../../event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { estimateCost } from "../../../tracer/collector/cost";
import { computeSpanCost } from "../model-cost-matching";

// Catalog rates under test (llmModels.overlay.json), per token, from OpenAI's
// pricing page: gpt-image-2 $5 text in, $8 image in, $30 image out per
// million; gpt-image-1 $5 / $10 / $40; gpt-image-1-mini $2 / $2.50 / $8.
const IMAGE2_TEXT_IN = 5e-6;
const IMAGE2_IMAGE_IN = 8e-6;
const IMAGE2_IMAGE_OUT = 3e-5;
const IMAGE1_TEXT_IN = 5e-6;
const IMAGE1_IMAGE_IN = 1e-5;
const IMAGE1_IMAGE_OUT = 4e-5;
const IMAGE1_MINI_IMAGE_OUT = 8e-6;

/** A 1024x1024 answer on gpt-image is about this many output image tokens. */
const ONE_SQUARE_IMAGE = 1600;

describe("image model cost", () => {
  describe("given a generation call that reports text in and image out", () => {
    describe("when the span is costed", () => {
      /** @scenario an image generation is priced by the image tokens it produced */
      it("prices the text prompt and the output image at their own rates", () => {
        const result = computeSpanCost({
          attrs: {
            "gen_ai.operation.name": "image_generation",
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
          },
          promptTokens: 14,
          completionTokens: 0,
        });
        expect(result).toBeCloseTo(
          14 * IMAGE2_TEXT_IN + ONE_SQUARE_IMAGE * IMAGE2_IMAGE_OUT,
          12,
        );
        expect(result).toBeGreaterThan(0);
      });
    });
  });

  describe("given an edit call that reports image in as well", () => {
    describe("when the span is costed", () => {
      /** @scenario an image edit is priced for the pixels it read and the pixels it wrote */
      it("prices all three buckets", () => {
        const result = computeSpanCost({
          attrs: {
            "gen_ai.operation.name": "image_edit",
            "gen_ai.request.model": "openai/gpt-image-1",
            "gen_ai.usage.input_image_tokens": 323,
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
          },
          promptTokens: 20,
          completionTokens: 0,
        });
        expect(result).toBeCloseTo(
          20 * IMAGE1_TEXT_IN +
            323 * IMAGE1_IMAGE_IN +
            ONE_SQUARE_IMAGE * IMAGE1_IMAGE_OUT,
          12,
        );
      });
    });
  });

  describe("given a span carrying only image tokens", () => {
    describe("when the span is costed", () => {
      /** @scenario an image call with no text usage still gets a cost */
      it("consults the registry for image tokens alone", () => {
        const result = computeSpanCost({
          attrs: {
            "gen_ai.request.model": "openai/gpt-image-1-mini",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
          },
          promptTokens: 0,
          completionTokens: 0,
        });
        expect(result).toBeCloseTo(
          ONE_SQUARE_IMAGE * IMAGE1_MINI_IMAGE_OUT,
          12,
        );
      });

      /** @scenario the image count alone prices nothing */
      it("charges nothing for an image count with no tokens", () => {
        const result = computeSpanCost({
          attrs: {
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.image_count": 3,
          },
          promptTokens: 0,
          completionTokens: 0,
        });
        expect(result).toBe(0);
      });
    });
  });

  describe("given the estimateCost arithmetic", () => {
    const imageEntry = {
      projectId: "",
      model: "openai/gpt-image-2",
      regex: "^(openai\\/)?gpt-image-2",
      inputCostPerToken: IMAGE2_TEXT_IN,
      outputCostPerToken: 0,
      inputImageCostPerToken: IMAGE2_IMAGE_IN,
      outputImageCostPerToken: IMAGE2_IMAGE_OUT,
    };

    /** @scenario a generation prices text in plus image out */
    it("prices a generation from text in and image out", () => {
      expect(
        estimateCost({
          llmModelCost: imageEntry,
          inputTokens: 14,
          outputImageTokens: 196,
        }),
      ).toBeCloseTo(14 * IMAGE2_TEXT_IN + 196 * IMAGE2_IMAGE_OUT, 12);
    });

    /** @scenario an edit prices text in, image in and image out */
    it("prices an edit from all three buckets", () => {
      expect(
        estimateCost({
          llmModelCost: imageEntry,
          inputTokens: 14,
          inputImageTokens: 323,
          outputImageTokens: 196,
        }),
      ).toBeCloseTo(
        14 * IMAGE2_TEXT_IN + 323 * IMAGE2_IMAGE_IN + 196 * IMAGE2_IMAGE_OUT,
        12,
      );
    });

    /** @scenario a rule that prices only image tokens is a priced rule */
    it("treats an image-only rate as priced", () => {
      expect(
        estimateCost({
          llmModelCost: {
            projectId: "",
            model: "x",
            regex: "^x",
            outputImageCostPerToken: IMAGE2_IMAGE_OUT,
          },
          outputImageTokens: 100,
        }),
      ).toBeCloseTo(100 * IMAGE2_IMAGE_OUT, 12);
    });

    /** @scenario a model with no rate at all still reports "cannot price" */
    it("returns undefined for an unpriced model carrying image tokens", () => {
      expect(
        estimateCost({
          llmModelCost: { projectId: "", model: "x", regex: "^x" },
          outputImageTokens: 1600,
        }),
      ).toBeUndefined();
    });

    /** @scenario a chat model never bills pixels it cannot produce */
    it("prices image tokens at zero on a model with no image rate", () => {
      expect(
        estimateCost({
          llmModelCost: {
            projectId: "",
            model: "openai/gpt-4o",
            regex: "^(openai\\/)?gpt-4o$",
            inputCostPerToken: 2.5e-6,
            outputCostPerToken: 1e-5,
          },
          inputTokens: 10,
          outputImageTokens: 1600,
        }),
      ).toBeCloseTo(10 * 2.5e-6, 12);
    });
  });

  describe("given the same image call on the trace and on the spend wire", () => {
    describe("when both are priced", () => {
      /** @scenario the trace span cost and the budget debit agree on an image call */
      it("states one figure on both surfaces", () => {
        const usage = {
          ...EMPTY_SPEND_USAGE,
          input_tokens: 14,
          output_tokens: 0,
          input_image_tokens: 323,
          output_image_tokens: ONE_SQUARE_IMAGE,
          image_count: 1,
        };
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "openai/gpt-image-2",
          usage,
        });

        const spanUsd = computeSpanCost({
          attrs: {
            "gen_ai.operation.name": "image_edit",
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.input_image_tokens": usage.input_image_tokens,
            "gen_ai.usage.output_image_tokens": usage.output_image_tokens,
            "gen_ai.usage.image_count": usage.image_count,
          },
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
        });

        expect(Math.round(spanUsd * NANO_USD_PER_USD)).toBe(costNanoUsd);
        expect(costNanoUsd).toBeGreaterThan(0);
      });
    });
  });
});
