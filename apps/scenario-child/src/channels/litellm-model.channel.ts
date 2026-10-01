import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LiteLLMParams } from "@langwatch/scenario-contract";

export type LitellmModelInput = Readonly<{ litellmParams: LiteLLMParams; nlpServiceUrl: string }>;

/** Language models served through the NLP engine's LiteLLM proxy. */
export interface LitellmModelChannel {
  model(input: LitellmModelInput): LanguageModelV3;
  /** The same model, with reasoning turned off where the judge's forced tool call needs it. */
  judgeModel(input: LitellmModelInput): LanguageModelV3;
}
