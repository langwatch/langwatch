import { describe, expect, it } from "vitest";
import {
  estimateCost,
  matchModelCostWithFallbacks,
  normalizeBedrockModelId,
  normalizeModelName,
} from "../cost";
import { getStaticModelCosts } from "../../../modelProviders/llmModelCost";
import type { MaybeStoredLLMModelCost } from "../../../modelProviders/llmModelCost";

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

describe("estimateCost", () => {
  const opusWithCache: MaybeStoredLLMModelCost = {
    projectId: "",
    model: "anthropic/claude-opus-4-7",
    regex: "^(anthropic\\/)?claude-opus-4[.-]7$",
    inputCostPerToken: 0.00003,
    outputCostPerToken: 0.00015,
    cacheReadCostPerToken: 0.000003,
    cacheCreationCostPerToken: 0.0000375,
  };

  describe("when only input and output tokens are given", () => {
    it("prices input and output at their respective rates", () => {
      expect(
        estimateCost({
          llmModelCost: opusWithCache,
          inputTokens: 1000,
          outputTokens: 100,
        }),
      ).toBeCloseTo(1000 * 0.00003 + 100 * 0.00015, 10);
    });
  });

  describe("when cache read and write tokens are given", () => {
    it("prices each bucket at its own rate, on top of the non-cached input", () => {
      const cost = estimateCost({
        llmModelCost: opusWithCache,
        inputTokens: 510,
        outputTokens: 12,
        cacheReadTokens: 37127,
        cacheCreationTokens: 14,
      });
      expect(cost).toBeCloseTo(
        510 * 0.00003 +
          12 * 0.00015 +
          37127 * 0.000003 +
          14 * 0.0000375,
        10,
      );
    });

    it("costs a mostly-cached follow-up far below pricing the cache reads as full input", () => {
      const cacheAware = estimateCost({
        llmModelCost: opusWithCache,
        inputTokens: 510,
        outputTokens: 12,
        cacheReadTokens: 37127,
        cacheCreationTokens: 14,
      })!;
      const asIfFullInput = estimateCost({
        llmModelCost: opusWithCache,
        inputTokens: 510 + 37127 + 14,
        outputTokens: 12,
      })!;
      expect(cacheAware).toBeLessThan(asIfFullInput);
    });
  });

  describe("when a cache rate is missing", () => {
    it("falls back to the input rate so cached tokens are never free", () => {
      const noCacheRates: MaybeStoredLLMModelCost = {
        projectId: "",
        model: "x/y",
        regex: "^x\\/y$",
        inputCostPerToken: 0.00001,
        outputCostPerToken: 0.00002,
      };
      expect(
        estimateCost({
          llmModelCost: noCacheRates,
          inputTokens: 100,
          cacheReadTokens: 50,
          cacheCreationTokens: 10,
        }),
      ).toBeCloseTo((100 + 50 + 10) * 0.00001, 10);
    });
  });

  describe("when the model has no rates at all", () => {
    it("returns undefined", () => {
      expect(
        estimateCost({
          llmModelCost: { projectId: "", model: "z", regex: "^z$" },
          inputTokens: 100,
          cacheReadTokens: 50,
        }),
      ).toBeUndefined();
    });
  });
});

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

describe("normalizeBedrockModelId", () => {
  describe("when given a regional Bedrock model id", () => {
    it("strips the region and converts vendor-dot to vendor-slash", () => {
      expect(normalizeBedrockModelId("eu.anthropic.claude-sonnet-4-6")).toBe(
        "anthropic/claude-sonnet-4-6",
      );
    });
  });

  describe("when given a versioned Bedrock model id", () => {
    it("strips the revision marker and version suffix", () => {
      expect(
        normalizeBedrockModelId("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
      ).toBe("anthropic/claude-haiku-4-5-20251001");
    });
  });

  describe("when given a litellm-style bedrock/ prefixed id (@regression)", () => {
    it("strips the bedrock/ envelope along with the region", () => {
      expect(
        normalizeBedrockModelId("bedrock/eu.anthropic.claude-sonnet-4-6"),
      ).toBe("anthropic/claude-sonnet-4-6");
    });

    it("strips the bedrock/ envelope on versioned ids", () => {
      expect(
        normalizeBedrockModelId(
          "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ),
      ).toBe("anthropic/claude-haiku-4-5-20251001");
    });

    it("strips the bedrock/ envelope when no region prefix is present", () => {
      expect(
        normalizeBedrockModelId("bedrock/anthropic.claude-sonnet-4-6"),
      ).toBe("anthropic/claude-sonnet-4-6");
    });
  });

  describe("when given a non-Bedrock model id", () => {
    it("leaves a vendor-slash model untouched", () => {
      expect(normalizeBedrockModelId("openai/gpt-4o")).toBe("openai/gpt-4o");
    });

    it("leaves a bare model name untouched", () => {
      expect(normalizeBedrockModelId("gpt-4o")).toBe("gpt-4o");
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

    it("matches real anthropic/claude-opus-4-5 entry by dotted version", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4.5", realCosts)?.model
      ).toBe("anthropic/claude-opus-4-5");
    });

    it("matches real anthropic/claude-opus-4-6 entry by dotted version", () => {
      expect(
        matchModelCostWithFallbacks("claude-opus-4.6", realCosts)?.model
      ).toBe("anthropic/claude-opus-4-6");
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

  describe("when model id comes from Bedrock (@regression)", () => {
    const realCosts = getStaticModelCosts();

    /** @scenario A bare regional Bedrock model id keeps resolving registry pricing */
    it("matches eu.anthropic.claude-sonnet-4-6 to anthropic/claude-sonnet-4-6", () => {
      expect(
        matchModelCostWithFallbacks("eu.anthropic.claude-sonnet-4-6", realCosts)
          ?.model
      ).toBe("anthropic/claude-sonnet-4-6");
    });

    /** @scenario A bedrock/-prefixed regional model id resolves registry pricing */
    it("matches bedrock/eu.anthropic.claude-sonnet-4-6 to anthropic/claude-sonnet-4-6", () => {
      expect(
        matchModelCostWithFallbacks(
          "bedrock/eu.anthropic.claude-sonnet-4-6",
          realCosts
        )?.model
      ).toBe("anthropic/claude-sonnet-4-6");
    });

    /** @scenario A bedrock/-prefixed versioned model id resolves registry pricing */
    it("matches bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0 to anthropic/claude-haiku-4-5", () => {
      expect(
        matchModelCostWithFallbacks(
          "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
          realCosts
        )?.model
      ).toBe("anthropic/claude-haiku-4-5");
    });

    /** @scenario A custom cost regex written against the bedrock/-prefixed spelling still wins */
    it("prefers a custom cost regex anchored on the bedrock/ spelling over the registry", () => {
      const customCost: MaybeStoredLLMModelCost = {
        projectId: "proj1",
        model: "bedrock/eu.anthropic.claude-sonnet-4-6",
        regex: "^bedrock\\/eu\\.anthropic\\.claude-sonnet-4-6$",
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
      };
      expect(
        matchModelCostWithFallbacks("bedrock/eu.anthropic.claude-sonnet-4-6", [
          customCost,
          ...realCosts,
        ])?.model
      ).toBe("bedrock/eu.anthropic.claude-sonnet-4-6");
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
