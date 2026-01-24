/**
 * Unit tests for reasoning boundary layer functions.
 *
 * These functions handle the mapping between the unified 'reasoning' field
 * and provider-specific parameters at the boundary when calling LLM APIs.
 *
 * IMPORTANT: LiteLLM expects 'reasoning_effort' for ALL providers and transforms
 * it internally to provider-specific parameters:
 * - Anthropic: reasoning_effort -> output_config={"effort": ...} + beta header
 * - Gemini: reasoning_effort -> thinking_level or thinking with budget
 * - OpenAI: reasoning_effort -> passed as-is
 */
import { describe, expect, it, vi } from "vitest";
import {
  mapReasoningToProvider,
  normalizeReasoningFromProviderFields,
  LITELLM_PARAMETER_TRANSLATION,
} from "../reasoningBoundary";

// Mock the model registry
vi.mock("../../modelProviders/registry", () => ({
  getModelById: vi.fn((modelId: string) => {
    // Return mock model data based on modelId
    // Note: Model registry still uses provider-specific names for UI clarity
    // Translation to reasoning_effort happens in mapReasoningToProvider
    const models: Record<
      string,
      { reasoningConfig?: { parameterName: string } }
    > = {
      "openai/gpt-5": {
        reasoningConfig: { parameterName: "reasoning_effort" },
      },
      "gemini/gemini-3-flash": {
        reasoningConfig: { parameterName: "thinkingLevel" },
      },
      "anthropic/claude-opus-4": {
        reasoningConfig: { parameterName: "effort" },
      },
      "gemini/gemini-2.5-pro": {
        reasoningConfig: { parameterName: "thinkingLevel" },
      },
      "anthropic/claude-opus-4.5": {
        reasoningConfig: { parameterName: "effort" },
      },
      "custom/model-with-custom-param": {
        reasoningConfig: { parameterName: "custom_reasoning" },
      },
      "openai/gpt-4.1": {}, // No reasoning config
    };
    return models[modelId];
  }),
}));

// Mock the provider helper - matches real behavior in modelProviderHelpers.ts
vi.mock("../../../utils/modelProviderHelpers", () => ({
  getProviderFromModel: vi.fn((model: string) => {
    // Real behavior: just extract provider from model string
    return model.split("/")[0] ?? "";
  }),
}));

describe("reasoningBoundary", () => {
  describe("LITELLM_PARAMETER_TRANSLATION", () => {
    it("maps effort to reasoning_effort", () => {
      expect(LITELLM_PARAMETER_TRANSLATION["effort"]).toBe("reasoning_effort");
    });

    it("maps thinkingLevel to reasoning_effort", () => {
      expect(LITELLM_PARAMETER_TRANSLATION["thinkingLevel"]).toBe("reasoning_effort");
    });

    it("maps reasoning_effort to reasoning_effort (passthrough)", () => {
      expect(LITELLM_PARAMETER_TRANSLATION["reasoning_effort"]).toBe("reasoning_effort");
    });
  });

  describe("mapReasoningToProvider", () => {
    // LiteLLM expects reasoning_effort for ALL providers
    // The function translates provider-specific names from model registry to reasoning_effort

    describe("uses reasoning_effort for all providers (LiteLLM requirement)", () => {
      it("maps reasoning to reasoning_effort for OpenAI models", () => {
        const result = mapReasoningToProvider("openai/gpt-5", "high");
        expect(result).toEqual({ reasoning_effort: "high" });
      });

      it("maps reasoning to reasoning_effort for Gemini models", () => {
        // Model registry returns thinkingLevel, but function translates to reasoning_effort
        const result = mapReasoningToProvider("gemini/gemini-3-flash", "low");
        expect(result).toEqual({ reasoning_effort: "low" });
      });

      it("maps reasoning to reasoning_effort for Anthropic models", () => {
        // Model registry returns effort, but function translates to reasoning_effort
        const result = mapReasoningToProvider(
          "anthropic/claude-opus-4",
          "medium",
        );
        expect(result).toEqual({ reasoning_effort: "medium" });
      });

      it("maps reasoning to reasoning_effort for Gemini 2.5 models", () => {
        const result = mapReasoningToProvider("gemini/gemini-2.5-pro", "medium");
        expect(result).toEqual({ reasoning_effort: "medium" });
      });

      it("maps reasoning to reasoning_effort for Anthropic Claude Opus 4.5", () => {
        const result = mapReasoningToProvider("anthropic/claude-opus-4.5", "high");
        expect(result).toEqual({ reasoning_effort: "high" });
      });

      it("passes through custom_reasoning unchanged (not in translation map)", () => {
        // Custom parameters that are not in LITELLM_PARAMETER_TRANSLATION are passed through
        const result = mapReasoningToProvider(
          "custom/model-with-custom-param",
          "high",
        );
        expect(result).toEqual({ custom_reasoning: "high" });
      });
    });

    describe("when model has no reasoningConfig (fallback to provider mapping)", () => {
      it("falls back to reasoning_effort for unknown OpenAI models", () => {
        const result = mapReasoningToProvider("openai/gpt-4.1", "high");
        expect(result).toEqual({ reasoning_effort: "high" });
      });

      it("falls back to reasoning_effort for unknown Gemini models", () => {
        // Previously returned thinkingLevel, now returns reasoning_effort
        const result = mapReasoningToProvider("gemini/unknown-model", "low");
        expect(result).toEqual({ reasoning_effort: "low" });
      });

      it("falls back to reasoning_effort for unknown Anthropic models", () => {
        // Previously returned effort, now returns reasoning_effort
        const result = mapReasoningToProvider(
          "anthropic/unknown-model",
          "medium",
        );
        expect(result).toEqual({ reasoning_effort: "medium" });
      });

      it("defaults to reasoning_effort for completely unknown providers", () => {
        const result = mapReasoningToProvider("unknown/model", "high");
        expect(result).toEqual({ reasoning_effort: "high" });
      });
    });

    describe("when reasoning is not set", () => {
      it("returns undefined when reasoning is undefined", () => {
        const result = mapReasoningToProvider("openai/gpt-5", undefined);
        expect(result).toBeUndefined();
      });

      it("returns undefined when reasoning is empty string", () => {
        const result = mapReasoningToProvider("openai/gpt-5", "");
        expect(result).toBeUndefined();
      });
    });
  });

  describe("normalizeReasoningFromProviderFields", () => {
    describe("when reasoning field is set", () => {
      it("returns reasoning when it is set", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning: "high",
        });
        expect(result).toBe("high");
      });

      it("reasoning takes precedence over reasoning_effort", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning: "high",
          reasoning_effort: "low",
        });
        expect(result).toBe("high");
      });

      it("reasoning takes precedence over all provider-specific fields", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning: "high",
          reasoning_effort: "low",
          thinkingLevel: "medium",
          effort: "low",
        });
        expect(result).toBe("high");
      });
    });

    describe("when normalizing provider-specific fields", () => {
      it("normalizes reasoning_effort to reasoning", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning_effort: "high",
        });
        expect(result).toBe("high");
      });

      it("normalizes thinkingLevel to reasoning", () => {
        const result = normalizeReasoningFromProviderFields({
          thinkingLevel: "low",
        });
        expect(result).toBe("low");
      });

      it("normalizes effort to reasoning", () => {
        const result = normalizeReasoningFromProviderFields({
          effort: "medium",
        });
        expect(result).toBe("medium");
      });
    });

    describe("when multiple provider-specific fields are set (priority order)", () => {
      it("reasoning_effort takes precedence over thinkingLevel", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning_effort: "high",
          thinkingLevel: "low",
        });
        expect(result).toBe("high");
      });

      it("thinkingLevel takes precedence over effort", () => {
        const result = normalizeReasoningFromProviderFields({
          thinkingLevel: "low",
          effort: "high",
        });
        expect(result).toBe("low");
      });

      it("follows priority: reasoning > reasoning_effort > thinkingLevel > effort", () => {
        const result = normalizeReasoningFromProviderFields({
          effort: "low",
          thinkingLevel: "medium",
          reasoning_effort: "high",
        });
        expect(result).toBe("high");
      });
    });

    describe("when no reasoning fields are set", () => {
      it("returns undefined when all fields are undefined", () => {
        const result = normalizeReasoningFromProviderFields({});
        expect(result).toBeUndefined();
      });

      it("returns undefined when passed empty object", () => {
        const result = normalizeReasoningFromProviderFields({
          reasoning: undefined,
          reasoning_effort: undefined,
          thinkingLevel: undefined,
          effort: undefined,
        });
        expect(result).toBeUndefined();
      });
    });
  });
});
