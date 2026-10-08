import { describe, expect, it } from "vitest";
import { VARIABLE_PRICE_ROUTERS } from "~/server/modelProviders/__tests__/variablePriceRouters.test-helpers";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import { extractLLMCallInfo } from "../dspyLLMCallCost";
import type { DSPyLLMCall } from "../types";

const chatCompletion = (model: string): DSPyLLMCall => ({
  hash: "call-1",
  __class__: "dspy.LM",
  response: {
    object: "chat.completion",
    model,
    usage: { prompt_tokens: 1000, completion_tokens: 500 },
  },
});

describe("extractLLMCallInfo", () => {
  const price = extractLLMCallInfo(getStaticModelCosts());

  describe("given a chat completion on a priced model", () => {
    it("prices it from the registry", () => {
      const call = price(chatCompletion("openai/gpt-5-mini"));
      expect(call.model).toBe("openai/gpt-5-mini");
      expect(call.prompt_tokens).toBe(1000);
      expect(call.completion_tokens).toBe(500);
      expect(call.cost ?? 0).toBeGreaterThan(0);
    });
  });

  describe("given a chat completion routed through a variable-price router", () => {
    /** @scenario A DSPy step call on a router is never costed below zero */
    it.each(VARIABLE_PRICE_ROUTERS)("never costs %s below zero", (model) => {
      const call = price(chatCompletion(model));
      expect(call.cost ?? 0).toBeGreaterThanOrEqual(0);
    });
  });
});
