import { describe, expect, it } from "vitest";
import type { ModelMetadataForFrontend } from "../../../hooks/useModelProvidersSettings";
import {
  estimateReferenceCost,
  referenceModelOptions,
} from "../modelCostComparison";

// Spec: specs/analytics/model-cost-comparison.feature

const metadataWith = (
  pricing: ModelMetadataForFrontend["pricing"],
): ModelMetadataForFrontend =>
  ({ id: "x", name: "x", provider: "openai", pricing }) as never;

describe("estimateReferenceCost", () => {
  describe("when the reference model has complete pricing", () => {
    it("prices the period's tokens at the reference per-token rates", () => {
      // Scenario: 2M input + 500k output on a model at $3/M in, $15/M out
      const cost = estimateReferenceCost({
        promptTokens: 2_000_000,
        completionTokens: 500_000,
        pricing: { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015 },
      });
      expect(cost).toBeCloseTo(2_000_000 * 0.000003 + 500_000 * 0.000015, 10);
      expect(cost).toBeCloseTo(13.5, 6);
    });
  });

  describe("when pricing is missing or incomplete", () => {
    it("returns undefined instead of a partial estimate", () => {
      expect(
        estimateReferenceCost({
          promptTokens: 1000,
          completionTokens: 1000,
          pricing: undefined,
        }),
      ).toBeUndefined();
      expect(
        estimateReferenceCost({
          promptTokens: 1000,
          completionTokens: 1000,
          pricing: null,
        }),
      ).toBeUndefined();
      expect(
        estimateReferenceCost({
          promptTokens: 1000,
          completionTokens: 1000,
          pricing: { inputCostPerToken: 0.000003 },
        }),
      ).toBeUndefined();
    });
  });

  describe("when the period has zero tokens", () => {
    it("estimates zero", () => {
      expect(
        estimateReferenceCost({
          promptTokens: 0,
          completionTokens: 0,
          pricing: { inputCostPerToken: 0.000003, outputCostPerToken: 0.000015 },
        }),
      ).toBe(0);
    });
  });
});

describe("referenceModelOptions", () => {
  describe("when some models lack catalog pricing", () => {
    it("offers only models with complete pricing, sorted", () => {
      const options = referenceModelOptions({
        "openai/gpt-5-mini": metadataWith({
          inputCostPerToken: 0.00000025,
          outputCostPerToken: 0.000002,
        }),
        "custom/qwen3-14b": metadataWith(undefined as never),
        "anthropic/claude-sonnet-4-6": metadataWith({
          inputCostPerToken: 0.000003,
          outputCostPerToken: 0.000015,
        }),
        "custom/half-priced": metadataWith({
          inputCostPerToken: 0.000001,
        } as never),
      });
      expect(options).toEqual([
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5-mini",
      ]);
    });
  });

  describe("when metadata has not loaded yet", () => {
    it("returns an empty list", () => {
      expect(referenceModelOptions(undefined)).toEqual([]);
    });
  });
});
