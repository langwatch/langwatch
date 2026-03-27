import { describe, expect, it } from "vitest";
import {
  stripProviderSubtype,
  stripDateSuffix,
  matchModelCostWithFallbacks,
  computeSpanCost,
} from "../model-cost-matching";
import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import { matchingLLMModelCost } from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";

describe("stripProviderSubtype", () => {
  it("strips subtype from provider prefix", () => {
    expect(stripProviderSubtype("openai.responses/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  it("strips subtype from azure.chat prefix", () => {
    expect(stripProviderSubtype("azure.chat/gpt-4o")).toBe("azure/gpt-4o");
  });

  it("leaves model without subtype unchanged", () => {
    expect(stripProviderSubtype("openai/gpt-4o")).toBe("openai/gpt-4o");
  });

  it("leaves model without provider prefix unchanged", () => {
    expect(stripProviderSubtype("gpt-4o")).toBe("gpt-4o");
  });
});

describe("stripDateSuffix", () => {
  it("strips YYYY-MM-DD suffix", () => {
    expect(stripDateSuffix("gpt-5-mini-2025-08-07")).toBe("gpt-5-mini");
  });

  it("strips date suffix with provider prefix", () => {
    expect(stripDateSuffix("openai/gpt-5-mini-2025-08-07")).toBe("openai/gpt-5-mini");
  });

  it("leaves model without date suffix unchanged", () => {
    expect(stripDateSuffix("gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("does not strip non-date suffixes", () => {
    expect(stripDateSuffix("gpt-4o-turbo")).toBe("gpt-4o-turbo");
  });
});

describe("matchModelCostWithFallbacks", () => {
  const costs: MaybeStoredLLMModelCost[] = [
    {
      projectId: "",
      model: "openai/gpt-5-mini",
      regex: "^(openai\\/)?gpt-5-mini$",
      inputCostPerToken: 0.00000025,
      outputCostPerToken: 0.000002,
    },
  ];

  describe("when model has provider subtype and date suffix", () => {
    it("matches openai.responses/gpt-5-mini-2025-08-07 via cascading fallback", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        costs,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when model has provider subtype only", () => {
    it("matches openai.responses/gpt-5-mini via subtype stripping", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini",
        costs,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when model has date suffix only", () => {
    it("matches gpt-5-mini-2025-08-07 via date stripping", () => {
      const result = matchModelCostWithFallbacks(
        "gpt-5-mini-2025-08-07",
        costs,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("when exact match exists", () => {
    it("prefers the exact match over fallbacks", () => {
      const costsWithExact: MaybeStoredLLMModelCost[] = [
        {
          projectId: "",
          model: "openai.responses/gpt-5-mini-2025-08-07",
          regex: "^openai\\.responses\\/gpt-5-mini-2025-08-07$",
          inputCostPerToken: 0.001,
          outputCostPerToken: 0.002,
        },
        ...costs,
      ];
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        costsWithExact,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai.responses/gpt-5-mini-2025-08-07");
    });
  });

  describe("with real model costs from the registry", () => {
    const realCosts = getStaticModelCosts();

    it("matches openai.responses/gpt-5-mini-2025-08-07 to openai/gpt-5-mini", () => {
      const result = matchModelCostWithFallbacks(
        "openai.responses/gpt-5-mini-2025-08-07",
        realCosts,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai/gpt-5-mini");
    });

    it("matches dated model already in registry without date stripping", () => {
      const result = matchModelCostWithFallbacks(
        "gpt-4o-2024-11-20",
        realCosts,
        matchingLLMModelCost,
      );
      expect(result?.model).toBe("openai/gpt-4o-2024-11-20");
    });
  });
});

describe("computeSpanCost", () => {
  describe("when span has custom cost rates", () => {
    it("computes cost from custom rates", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.model.inputCostPerToken": 0.000005,
          "langwatch.model.outputCostPerToken": 0.000015,
        },
        promptTokens: 100,
        completionTokens: 50,
      });
      // 100 * 0.000005 + 50 * 0.000015 = 0.00125
      expect(result).toBeCloseTo(0.00125, 6);
    });
  });

  describe("when span has model in static registry", () => {
    it("uses static registry pricing", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "gpt-4o" },
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("when model is openai.responses/gpt-5-mini-2025-08-07", () => {
    it("resolves cost via cascading fallback", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "openai.responses/gpt-5-mini-2025-08-07" },
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("when model is passed as param", () => {
    it("uses the param over attributes", () => {
      const result = computeSpanCost({
        attrs: { "gen_ai.request.model": "totally-unknown-model" },
        model: "gpt-4o",
        promptTokens: 1000,
        completionTokens: 500,
      });
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("when span has SDK-provided cost", () => {
    it("falls back to SDK cost", () => {
      const result = computeSpanCost({
        attrs: { "langwatch.span.cost": 0.005 },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBeCloseTo(0.005, 6);
    });
  });

  describe("when span is a guardrail with USD cost", () => {
    it("extracts guardrail cost", () => {
      const result = computeSpanCost({
        attrs: {
          "langwatch.span.type": "guardrail",
          "langwatch.output": {
            passed: true,
            cost: { amount: 0.0042, currency: "USD" },
          },
        },
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBeCloseTo(0.0042, 6);
    });
  });

  describe("when no cost information is available", () => {
    it("returns 0", () => {
      const result = computeSpanCost({
        attrs: {},
        promptTokens: null,
        completionTokens: null,
      });
      expect(result).toBe(0);
    });
  });
});
