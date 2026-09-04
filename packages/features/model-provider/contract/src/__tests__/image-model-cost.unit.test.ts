import { describe, expect, it } from "vitest";
import { estimateCost } from "../model-cost";
import type { ModelCostRate } from "../model-provider";

// Catalog rates under test (model-catalog.overlay.json), per token, from
// OpenAI's pricing page: gpt-image-2 $5 text in, $8 image in, $30 image out
// per million.
const IMAGE2_TEXT_IN = 5e-6;
const IMAGE2_IMAGE_IN = 8e-6;
const IMAGE2_IMAGE_OUT = 3e-5;

const NO_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation1hTokens: 0,
  inputAudioTokens: 0,
  outputAudioTokens: 0,
} as const;

const imageRate: ModelCostRate = {
  model: "openai/gpt-image-2",
  regex: "^(openai\\/)?gpt-image-2",
  inputCostPerToken: IMAGE2_TEXT_IN,
  outputCostPerToken: 0,
  inputImageCostPerToken: IMAGE2_IMAGE_IN,
  outputImageCostPerToken: IMAGE2_IMAGE_OUT,
};

describe("estimateCost with image token rates", () => {
  describe("given a generation that reports text in and image out", () => {
    /** @scenario a generation prices text in plus image out */
    it("prices a generation from text in and image out", () => {
      expect(
        estimateCost({
          ...NO_TOKENS,
          rate: imageRate,
          inputTokens: 14,
          outputImageTokens: 196,
        }),
      ).toBeCloseTo(14 * IMAGE2_TEXT_IN + 196 * IMAGE2_IMAGE_OUT, 12);
    });
  });

  describe("given an edit that reports all three buckets", () => {
    /** @scenario an edit prices text in, image in and image out */
    it("prices an edit from all three buckets", () => {
      expect(
        estimateCost({
          ...NO_TOKENS,
          rate: imageRate,
          inputTokens: 14,
          inputImageTokens: 323,
          outputImageTokens: 196,
        }),
      ).toBeCloseTo(
        14 * IMAGE2_TEXT_IN + 323 * IMAGE2_IMAGE_IN + 196 * IMAGE2_IMAGE_OUT,
        12,
      );
    });
  });

  describe("given a rate that names only image tokens", () => {
    /** @scenario a rule that prices only image tokens is a priced rule */
    it("treats an image-only rate as priced", () => {
      expect(
        estimateCost({
          ...NO_TOKENS,
          rate: {
            model: "x",
            regex: "^x",
            outputImageCostPerToken: IMAGE2_IMAGE_OUT,
          },
          outputImageTokens: 100,
        }),
      ).toBeCloseTo(100 * IMAGE2_IMAGE_OUT, 12);
    });
  });

  describe("given a model that names no rate at all", () => {
    /** @scenario a model with no rate at all still reports "cannot price" */
    it("returns undefined for an unpriced model carrying image tokens", () => {
      expect(
        estimateCost({
          ...NO_TOKENS,
          rate: { model: "x", regex: "^x" },
          outputImageTokens: 1600,
        }),
      ).toBeUndefined();
    });
  });

  describe("given a chat model with text rates and no image rate", () => {
    /** @scenario a chat model never bills pixels it cannot produce */
    it("prices image tokens at zero on a model with no image rate", () => {
      expect(
        estimateCost({
          ...NO_TOKENS,
          rate: {
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
});
