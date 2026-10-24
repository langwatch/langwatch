import {
  getStaticModelCostRates,
  getVariablePriceRouterIds,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { dspyStepOf } from "../experiment-dspy-step.rules.ts";

const routerIds = getVariablePriceRouterIds();

function stepCalling(model: string) {
  return dspyStepOf({
    tenantId: "project-1",
    experimentId: "experiment-1",
    param: {
      run_id: "run-1",
      index: "0",
      score: 0.5,
      label: "score",
      optimizer: { name: "MIPROv2", parameters: {} },
      predictors: [],
      examples: [],
      llm_calls: [
        {
          __class__: "dspy.LM",
          response: {
            object: "chat.completion",
            model,
            usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
          },
        },
      ],
      timestamps: { created_at: 1_700_000_000_000 },
    },
    costs: getStaticModelCostRates(),
    now: 1_700_000_000_000,
  });
}

describe("given a DSPy step whose LLM call went through a router", () => {
  it("has routers to check", () => {
    expect(routerIds.length).toBeGreaterThan(0);
  });

  describe("when the call is priced", () => {
    /** @scenario A DSPy step's call through a router is left unpriced */
    it.each(routerIds)("leaves %s unpriced rather than negative", (model) => {
      // The catalog states -1 per token for a router, which priced this call at -$2,000,000.
      const [call] = stepCalling(model).llmCalls;
      expect(call?.cost).toBeUndefined();
    });
  });
});

describe("given a DSPy step whose LLM call went to a priced model", () => {
  it("prices the call", () => {
    const [call] = stepCalling("openai/gpt-5-mini").llmCalls;
    expect(call?.cost).toBeGreaterThan(0);
  });
});
