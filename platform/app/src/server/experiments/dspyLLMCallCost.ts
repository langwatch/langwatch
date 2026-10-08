import type { MaybeStoredLLMModelCost } from "~/server/modelProviders/llmModelCost";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/tracer/collector/cost";
import type { DSPyLLMCall } from "./types";

/**
 * Reads the model and token usage off a DSPy step's LLM call and prices it
 * from the given model costs, the same registry every other cost path reads.
 * Calls that are not chat completions are returned unchanged.
 */
export const extractLLMCallInfo =
  (llmModelCosts: MaybeStoredLLMModelCost[]) =>
  (call: DSPyLLMCall): DSPyLLMCall => {
    if (
      call.__class__ === "dsp.modules.gpt3.GPT3" ||
      call.response?.object === "chat.completion"
    ) {
      const model = call.response?.model;
      const llmModelCost =
        model &&
        matchModelCostWithFallbacks(call.response.model, llmModelCosts);
      const promptTokens = call.response?.usage?.prompt_tokens;
      const completionTokens = call.response?.usage?.completion_tokens;
      const cost =
        llmModelCost &&
        estimateCost({
          llmModelCost,
          inputTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
        });
      return {
        ...call,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost,
      };
    }
    return call;
  };
