import { describe, expect, it } from "vitest";
import type { ModelMetadataForFrontend } from "../../../hooks/useModelProvidersSettings";
import {
  estimateReferenceCost,
  referenceModelOptions,
} from "../modelCostComparison";

// Spec: specs/analytics/model-cost-comparison.feature

// Anthropic Claude Sonnet 4.6's real catalog rates, so the arithmetic below is
// checkable against the published price list rather than invented numbers.
const SONNET = {
  inputCostPerToken: 0.000003,
  outputCostPerToken: 0.000015,
  inputCacheReadPerToken: 0.0000003,
  inputCacheWritePerToken: 0.00000375,
};

const noTokens = {
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const metadataWith = (
  pricing: ModelMetadataForFrontend["pricing"],
): ModelMetadataForFrontend =>
  ({ id: "x", name: "x", provider: "openai", pricing }) as never;

// A custom/self-hosted model's real cost is unknown, but the model metadata
// backfills its pricing with {0,0} so other consumers don't choke on missing
// fields. This fixture reproduces that shape.
const customModelMetadata = (): ModelMetadataForFrontend =>
  ({
    id: "custom/qwen3-14b",
    name: "qwen3-14b",
    provider: "custom",
    pricing: { inputCostPerToken: 0, outputCostPerToken: 0 },
  }) as never;

describe("estimateReferenceCost", () => {
  describe("when the period mixes fresh and cached input", () => {
    it("prices every token bucket at its own rate", () => {
      const cost = estimateReferenceCost({
        promptTokens: 2_000_000,
        completionTokens: 500_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 200_000,
        pricing: SONNET,
      });

      // 2M x $3/M + 500k x $15/M + 1M x $0.30/M + 200k x $3.75/M
      expect(cost).toBeCloseTo(6 + 7.5 + 0.3 + 0.75, 10);
      expect(cost).toBeCloseTo(14.55, 6);
    });

    it("counts the cached tokens rather than dropping them", () => {
      const withCache = estimateReferenceCost({
        promptTokens: 2_000_000,
        completionTokens: 500_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 200_000,
        pricing: SONNET,
      })!;
      const freshOnly = estimateReferenceCost({
        promptTokens: 2_000_000,
        completionTokens: 500_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        pricing: SONNET,
      })!;

      expect(freshOnly).toBeCloseTo(13.5, 6);
      expect(withCache).toBeGreaterThan(freshOnly);
    });
  });

  describe("when the model publishes no cache rates", () => {
    it("prices cached tokens at the plain input rate, as the recorded cost does", () => {
      const cost = estimateReferenceCost({
        promptTokens: 1_000_000,
        completionTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        pricing: {
          inputCostPerToken: 0.000003,
          outputCostPerToken: 0.000015,
        },
      });

      expect(cost).toBeCloseTo(3_000_000 * 0.000003, 10);
    });
  });

  describe("when pricing is missing or incomplete", () => {
    it("returns undefined instead of a partial estimate", () => {
      expect(
        estimateReferenceCost({ ...noTokens, pricing: undefined }),
      ).toBeUndefined();
      expect(
        estimateReferenceCost({ ...noTokens, pricing: null }),
      ).toBeUndefined();
      expect(
        estimateReferenceCost({
          ...noTokens,
          pricing: { inputCostPerToken: 0.000003 },
        }),
      ).toBeUndefined();
    });
  });

  describe("when both published rates are zero", () => {
    it("returns undefined rather than a confident $0 estimate", () => {
      // Self-hosted and custom models carry this placeholder, and so do the
      // handful of catalog rows whose price is not public.
      expect(
        estimateReferenceCost({
          promptTokens: 2_000_000,
          completionTokens: 500_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          pricing: { inputCostPerToken: 0, outputCostPerToken: 0 },
        }),
      ).toBeUndefined();
    });
  });

  describe("when the period has zero tokens", () => {
    it("estimates zero", () => {
      expect(estimateReferenceCost({ ...noTokens, pricing: SONNET })).toBe(0);
    });
  });
});

describe("referenceModelOptions", () => {
  describe("when some models lack catalog pricing", () => {
    it("offers only models with a usable published price, sorted", () => {
      const options = referenceModelOptions({
        modelMetadata: {
          "openai/gpt-5-mini": metadataWith({
            inputCostPerToken: 0.00000025,
            outputCostPerToken: 0.000002,
          }),
          "custom/qwen3-14b": metadataWith(undefined as never),
          "anthropic/claude-sonnet-4-6": metadataWith(SONNET),
          "custom/half-priced": metadataWith({
            inputCostPerToken: 0.000001,
          } as never),
        },
      });

      expect(options).toEqual([
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5-mini",
      ]);
    });
  });

  describe("when metadata has not loaded yet", () => {
    it("returns an empty list", () => {
      expect(referenceModelOptions({ modelMetadata: undefined })).toEqual([]);
    });
  });

  describe("when a model carries an all-zero placeholder price", () => {
    it("leaves it out, whether it is custom or a catalog row", () => {
      const options = referenceModelOptions({
        modelMetadata: {
          "anthropic/claude-sonnet-4-6": metadataWith(SONNET),
          "custom/qwen3-14b": customModelMetadata(),
          "gemini/lyria-3-pro-preview": metadataWith({
            inputCostPerToken: 0,
            outputCostPerToken: 0,
          }),
        },
      });

      expect(options).toEqual(["anthropic/claude-sonnet-4-6"]);
    });
  });
});
