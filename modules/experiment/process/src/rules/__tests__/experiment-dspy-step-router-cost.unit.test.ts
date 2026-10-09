/**
 * A DSPy step prices each LLM call from the cost registry. A router has no
 * rate of its own, so a call routed through one must never go below zero.
 * @see specs/trace-processing/catalog-router-cost.feature
 */
import type { DSPyStepRESTParams } from "@langwatch/experiment-contract";
import { getStaticModelCostRates } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { dspyStepOf } from "../experiment-dspy-step.rules.ts";

const stepCalling = (model: string): DSPyStepRESTParams => ({
  run_id: "run-1",
  index: "0",
  score: 1,
  label: "step",
  optimizer: { name: "BootstrapFewShot", parameters: {} },
  predictors: [],
  examples: [],
  llm_calls: [
    {
      __class__: "dspy.LM",
      response: {
        object: "chat.completion",
        model,
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
    },
  ],
  timestamps: { created_at: 0 },
});

const pricedCall = (model: string) =>
  dspyStepOf({
    tenantId: "project-1",
    experimentId: "experiment-1",
    param: stepCalling(model),
    costs: getStaticModelCostRates(),
    now: 0,
  }).llmCalls[0];

describe("dspyStepOf", () => {
  describe("given a chat completion on a priced model", () => {
    it("prices it from the registry", () => {
      const call = pricedCall("openai/gpt-5-mini");

      expect(call?.model).toBe("openai/gpt-5-mini");
      expect(call?.prompt_tokens).toBe(1000);
      expect(call?.completion_tokens).toBe(500);
      expect(call?.cost ?? 0).toBeGreaterThan(0);
    });
  });

  describe("given a chat completion routed through a variable-price router", () => {
    /** @scenario A DSPy step call on a router is never costed below zero */
    it.each(["nvidia/switchyard", "typesafe/jev-router", "openrouter/auto"])(
      "never costs %s below zero",
      (model) => {
        expect(pricedCall(model)?.cost ?? 0).toBeGreaterThanOrEqual(0);
      },
    );
  });
});
