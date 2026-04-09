import { describe, expect, it } from "vitest";
import {
  estimateCost,
  matchModelCostWithFallbacks,
  normalizeModelName,
} from "../cost";
import { getStaticModelCosts } from "../../../../modelProviders/llmModelCost";
import type { MaybeStoredLLMModelCost } from "../../../../modelProviders/llmModelCost";

const fakeModelCosts: MaybeStoredLLMModelCost[] = [
  {
    projectId: "",
    model: "openai/gpt-4o",
    regex: "^(openai\\/)?gpt-4o$",
    inputCostPerToken: 0.0000025,
    outputCostPerToken: 0.00001,
  },
  {
    projectId: "",
    model: "anthropic/claude-opus-4.5",
    regex: "^(anthropic\\/)?claude-opus-4[.-]5$",
    inputCostPerToken: 0.000005,
    outputCostPerToken: 0.000025,
  },
  {
    projectId: "",
    model: "deepseek/deepseek-v3.2",
    regex: "^(deepseek\\/)?deepseek-v3[.-]2$",
    inputCostPerToken: 0.00000025,
    outputCostPerToken: 0.00000038,
  },
  {
    projectId: "",
    model: "minimax/minimax-m2.1",
    regex: "^(minimax\\/)?minimax-m2[.-]1$",
    inputCostPerToken: 0.000001,
    outputCostPerToken: 0.000001,
  },
];

describe("normalizeModelName", () => {
  describe("when given uppercase letters", () => {
    it("converts to lowercase", () => {
      expect(normalizeModelName("GPT-4O")).toBe("gpt-4o");
    });

    it("converts mixed-case vendor prefix to lowercase", () => {
      expect(normalizeModelName("OpenAI/GPT-4O")).toBe("openai/gpt-4o");
    });
  });

  describe("when given vendor aliases", () => {
    it("normalizes deepseek-ai/ to deepseek/", () => {
      expect(normalizeModelName("deepseek-ai/deepseek-v3.2")).toBe(
        "deepseek/deepseek-v3.2"
      );
    });

    it("normalizes minimaxai/ to minimax/", () => {
      expect(normalizeModelName("minimaxai/minimax-m2.1")).toBe(
        "minimax/minimax-m2.1"
      );
    });

    it("normalizes zai-org/ to z-ai/", () => {
      expect(normalizeModelName("zai-org/glm-4.7")).toBe("z-ai/glm-4.7");
    });

    it("normalizes zhipu-ai/ to z-ai/", () => {
      expect(normalizeModelName("zhipu-ai/glm-4.7")).toBe("z-ai/glm-4.7");
    });
  });

  describe("when given quantization suffixes", () => {
    it("strips -fp8 suffix", () => {
      expect(normalizeModelName("gpt-4o-fp8")).toBe("gpt-4o");
    });

    it("strips -gptq suffix", () => {
      expect(normalizeModelName("gpt-4o-gptq")).toBe("gpt-4o");
    });

    it("strips -awq suffix", () => {
      expect(normalizeModelName("gpt-4o-awq")).toBe("gpt-4o");
    });

    it("strips -gguf suffix", () => {
      expect(normalizeModelName("gpt-4o-gguf")).toBe("gpt-4o");
    });

    it("strips -int4 suffix", () => {
      expect(normalizeModelName("gpt-4o-int4")).toBe("gpt-4o");
    });

    it("strips -int8 suffix", () => {
      expect(normalizeModelName("gpt-4o-int8")).toBe("gpt-4o");
    });
  });

  describe("when given a normal model name", () => {
    it("returns it lowercase without changes", () => {
      expect(normalizeModelName("openai/gpt-4o")).toBe("openai/gpt-4o");
    });
  });
});

describe("matchModelCostWithFallbacks", () => {
  describe("when model name matches exactly", () => {
    it("finds cost for model name without vendor prefix", () => {
      expect(matchModelCostWithFallbacks("gpt-4o", fakeModelCosts)?.model).toBe(
        "openai/gpt-4o"
      );
    });

    it("finds cost for model name with vendor prefix", () => {
      expect(
        matchModelCostWithFallbacks("openai/gpt-4o", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });
  });

  describe("when model name uses uppercase letters", () => {
    it("normalizes to lowercase before matching", () => {
      expect(matchModelCostWithFallbacks("GPT-4O", fakeModelCosts)?.model).toBe(
        "openai/gpt-4o"
      );
    });

    it("normalizes mixed-case vendor prefix to lowercase", () => {
      expect(
        matchModelCostWithFallbacks("OpenAI/GPT-4O", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });
  });

  describe("when model name uses dot or hyphen in version numbers", () => {
    it("matches claude-opus-4.5 with a dot", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4.5", fakeModelCosts)?.model
      ).toBe("anthropic/claude-opus-4.5");
    });

    it("matches claude-opus-4-5 with a hyphen (interchangeable with dot)", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4-5", fakeModelCosts)?.model
      ).toBe("anthropic/claude-opus-4.5");
    });

    it("matches minimax-m2.1 with a dot", () => {
      expect(
        matchModelCostWithFallbacks("minimax-m2.1", fakeModelCosts)?.model
      ).toBe("minimax/minimax-m2.1");
    });

    it("matches minimax-m2-1 with a hyphen", () => {
      expect(
        matchModelCostWithFallbacks("minimax-m2-1", fakeModelCosts)?.model
      ).toBe("minimax/minimax-m2.1");
    });
  });

  describe("when model name has an extra vendor prefix from a proxy", () => {
    it("strips one prefix level and retries", () => {
      expect(
        matchModelCostWithFallbacks("together_ai/gpt-4o", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });

    it("strips multiple prefix levels for multi-segment names", () => {
      expect(
        matchModelCostWithFallbacks("together_ai/openai/gpt-4o", fakeModelCosts)
          ?.model
      ).toBe("openai/gpt-4o");
    });
  });

  describe("when model name uses a known vendor alias", () => {
    it("normalizes deepseek-ai/ to deepseek/ before matching", () => {
      expect(
        matchModelCostWithFallbacks("deepseek-ai/deepseek-v3.2", fakeModelCosts)
          ?.model
      ).toBe("deepseek/deepseek-v3.2");
    });

    it("normalizes minimaxai/ to minimax/ before matching", () => {
      expect(
        matchModelCostWithFallbacks("minimaxai/minimax-m2.1", fakeModelCosts)?.model
      ).toBe("minimax/minimax-m2.1");
    });
  });

  describe("when model name has a quantization suffix", () => {
    it("strips -fp8 suffix before matching", () => {
      expect(
        matchModelCostWithFallbacks("gpt-4o-fp8", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });

    it("strips -gptq suffix before matching", () => {
      expect(
        matchModelCostWithFallbacks("gpt-4o-gptq", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });

    it("strips -awq suffix before matching", () => {
      expect(
        matchModelCostWithFallbacks("gpt-4o-awq", fakeModelCosts)?.model
      ).toBe("openai/gpt-4o");
    });
  });

  describe("when model name has a -turbo suffix", () => {
    it("does NOT strip -turbo (turbo is a distinct SKU with its own pricing)", () => {
      expect(
        matchModelCostWithFallbacks("gpt-4o-turbo", fakeModelCosts)
      ).toBeUndefined();
    });
  });

  describe("when model name has no match", () => {
    it("returns undefined for an unknown model", () => {
      expect(
        matchModelCostWithFallbacks("made-up-model-xyz", fakeModelCosts)
      ).toBeUndefined();
    });

    it("returns undefined for an empty string", () => {
      expect(matchModelCostWithFallbacks("", fakeModelCosts)).toBeUndefined();
    });
  });

  describe("when model costs list is empty", () => {
    it("returns undefined", () => {
      expect(matchModelCostWithFallbacks("gpt-4o", [])).toBeUndefined();
    });
  });

  describe("with real model costs from the registry", () => {
    const realCosts = getStaticModelCosts();

    it("matches real openai/gpt-4o entry by bare model name", () => {
      expect(matchModelCostWithFallbacks("gpt-4o", realCosts)?.model).toBe(
        "openai/gpt-4o"
      );
    });

    it("matches real anthropic/claude-opus-4.5 entry by hyphenated version", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4-5", realCosts)?.model
      ).toBe("anthropic/claude-opus-4.5");
    });

    it("matches real anthropic/claude-opus-4.6 entry by hyphenated version", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4-6", realCosts)?.model
      ).toBe("anthropic/claude-opus-4.6");
    });

    it("matches real deepseek/deepseek-v3.2 via deepseek-ai/ alias", () => {
      expect(
        matchModelCostWithFallbacks("deepseek-ai/deepseek-v3.2", realCosts)?.model
      ).toBe("deepseek/deepseek-v3.2");
    });

    it("matches real minimax/minimax-m2.1 via minimaxai/ alias", () => {
      expect(
        matchModelCostWithFallbacks("minimaxai/minimax-m2.1", realCosts)?.model
      ).toBe("minimax/minimax-m2.1");
    });
  });

  describe("when a custom regex expects original casing", () => {
    const caseSensitiveCosts: MaybeStoredLLMModelCost[] = [
      {
        projectId: "proj1",
        model: "custom/MyModel-V2",
        regex: "^MyModel-V2$",
        inputCostPerToken: 0.001,
        outputCostPerToken: 0.002,
      },
      ...fakeModelCosts,
    ];

    it("matches raw model string before normalizing", () => {
      expect(
        matchModelCostWithFallbacks("MyModel-V2", caseSensitiveCosts)?.model
      ).toBe("custom/MyModel-V2");
    });

    it("still falls back to normalized matching for lowercase input", () => {
      expect(
        matchModelCostWithFallbacks("gpt-4o", caseSensitiveCosts)?.model
      ).toBe("openai/gpt-4o");
    });

    it("falls back to normalized matching when raw does not match", () => {
      expect(
        matchModelCostWithFallbacks("GPT-4O", caseSensitiveCosts)?.model
      ).toBe("openai/gpt-4o");
    });
  });
});

describe("estimateCost", () => {
  const fullPricing: MaybeStoredLLMModelCost = {
    projectId: "",
    model: "openai/gpt-4o",
    regex: "^(openai\\/)?gpt-4o$",
    inputCostPerToken: 0.0000025,
    outputCostPerToken: 0.00001,
  };

  const noPricing: MaybeStoredLLMModelCost = {
    projectId: "",
    model: "unknown/model",
    regex: "^unknown$",
  };

  describe("when model has full pricing", () => {
    it("calculates cost from both input and output tokens", () => {
      expect(
        estimateCost({
          llmModelCost: fullPricing,
          inputTokens: 1000,
          outputTokens: 500,
        })
      ).toBeCloseTo(0.0075, 6);
    });

    it("returns 0 when both token counts are 0", () => {
      expect(
        estimateCost({
          llmModelCost: fullPricing,
          inputTokens: 0,
          outputTokens: 0,
        })
      ).toBe(0);
    });

    it("treats undefined token counts as 0", () => {
      expect(estimateCost({ llmModelCost: fullPricing })).toBe(0);
    });
  });

  describe("when model has no pricing", () => {
    it("returns undefined", () => {
      expect(
        estimateCost({
          llmModelCost: noPricing,
          inputTokens: 1000,
          outputTokens: 500,
        })
      ).toBeUndefined();
    });
  });
});
