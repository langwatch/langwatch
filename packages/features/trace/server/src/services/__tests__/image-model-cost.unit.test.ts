import { TraceSpanCostMatchingService } from "../trace-span-cost-matching.service";
import { describe, expect, it } from "vitest";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

// Catalog rates under test (model-catalog.overlay.json), per token, from
// OpenAI's pricing page: gpt-image-2 $5 text in, $8 image in, $30 image out
// per million; gpt-image-1 $5 / $10 / $40; gpt-image-1-mini $2 / $2.50 / $8.
const IMAGE2_TEXT_IN = 5e-6;
const IMAGE2_IMAGE_OUT = 3e-5;
const IMAGE1_TEXT_IN = 5e-6;
const IMAGE1_IMAGE_IN = 1e-5;
const IMAGE1_IMAGE_OUT = 4e-5;
const IMAGE1_MINI_IMAGE_OUT = 8e-6;

/** A 1024x1024 answer on gpt-image is about this many output image tokens. */
const ONE_SQUARE_IMAGE = 1600;

const costOf = ({
  attrs,
  promptTokens = 0,
  completionTokens = 0,
}: {
  attrs: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
}): number =>
  TraceSpanCostMatchingService.computeSpanCost({
    attrs: attrs as NormalizedAttributes,
    promptTokens,
    completionTokens,
  });

describe("image model cost", () => {
  describe("given a generation call that reports text in and image out", () => {
    describe("when the span is costed", () => {
      /** @scenario an image generation is priced by the image tokens it produced */
      it("prices the text prompt and the output image at their own rates", () => {
        const result = costOf({
          attrs: {
            "gen_ai.operation.name": "image_generation",
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
          },
          promptTokens: 14,
        });
        expect(result).toBeCloseTo(14 * IMAGE2_TEXT_IN + ONE_SQUARE_IMAGE * IMAGE2_IMAGE_OUT, 12);
        expect(result).toBeGreaterThan(0);
      });
    });
  });

  describe("given an edit call that reports image in as well", () => {
    describe("when the span is costed", () => {
      /** @scenario an image edit is priced for the pixels it read and the pixels it wrote */
      it("prices all three buckets", () => {
        const result = costOf({
          attrs: {
            "gen_ai.operation.name": "image_edit",
            "gen_ai.request.model": "openai/gpt-image-1",
            "gen_ai.usage.input_image_tokens": 323,
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
          },
          promptTokens: 20,
        });
        expect(result).toBeCloseTo(
          20 * IMAGE1_TEXT_IN + 323 * IMAGE1_IMAGE_IN + ONE_SQUARE_IMAGE * IMAGE1_IMAGE_OUT,
          12,
        );
      });
    });
  });

  describe("given a span carrying only image tokens", () => {
    describe("when the span is costed", () => {
      /** @scenario an image call with no text usage still gets a cost */
      it("consults the registry for image tokens alone", () => {
        const result = costOf({
          attrs: {
            "gen_ai.request.model": "openai/gpt-image-1-mini",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
          },
        });
        expect(result).toBeCloseTo(ONE_SQUARE_IMAGE * IMAGE1_MINI_IMAGE_OUT, 12);
      });

      /** @scenario the image count alone prices nothing */
      it("charges nothing for an image count with no tokens", () => {
        const result = costOf({
          attrs: {
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.image_count": 3,
          },
        });
        expect(result).toBe(0);
      });
    });
  });

  describe("given a custom cost rule on an image model", () => {
    // The enrichment stamps only the rates a custom rule can hold, which are
    // text and cache. A custom cost rule has no image columns.
    const CUSTOM_TEXT_IN = 1e-6;
    const CUSTOM_TEXT_OUT = 2e-6;

    describe("when a generation is costed", () => {
      /** @scenario a custom text rate does not zero the image tokens */
      it("prices the text at the custom rate and the image at the catalog rate", () => {
        const result = costOf({
          attrs: {
            "gen_ai.operation.name": "image_generation",
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
            "langwatch.model.inputCostPerToken": CUSTOM_TEXT_IN,
            "langwatch.model.outputCostPerToken": CUSTOM_TEXT_OUT,
          },
          promptTokens: 14,
        });
        expect(result).toBeCloseTo(14 * CUSTOM_TEXT_IN + ONE_SQUARE_IMAGE * IMAGE2_IMAGE_OUT, 12);
      });
    });

    describe("when an edit is costed", () => {
      /** @scenario a custom text rate does not zero the image tokens */
      it("fills both image buckets from the catalog", () => {
        const result = costOf({
          attrs: {
            "gen_ai.operation.name": "image_edit",
            "gen_ai.request.model": "openai/gpt-image-1",
            "gen_ai.usage.input_image_tokens": 323,
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "gen_ai.usage.image_count": 1,
            "langwatch.model.inputCostPerToken": CUSTOM_TEXT_IN,
            "langwatch.model.outputCostPerToken": CUSTOM_TEXT_OUT,
          },
          promptTokens: 20,
        });
        expect(result).toBeCloseTo(
          20 * CUSTOM_TEXT_IN + 323 * IMAGE1_IMAGE_IN + ONE_SQUARE_IMAGE * IMAGE1_IMAGE_OUT,
          12,
        );
      });
    });

    describe("when the rule zeroes every rate it carries", () => {
      /** @scenario an override that prices nothing keeps the images free */
      it("charges nothing, because the zeroes are the policy", () => {
        const result = costOf({
          attrs: {
            "gen_ai.request.model": "openai/gpt-image-2",
            "gen_ai.usage.output_image_tokens": ONE_SQUARE_IMAGE,
            "langwatch.model.inputCostPerToken": 0,
            "langwatch.model.outputCostPerToken": 0,
          },
          promptTokens: 14,
        });
        expect(result).toBe(0);
      });
    });
  });
});
