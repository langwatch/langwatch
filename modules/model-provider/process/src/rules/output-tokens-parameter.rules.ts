import type { OutputTokensParameter } from "@langwatch/model-provider-contract";

/**
 * OpenAI's reasoning models (the o-series, GPT 5 on) refuse `max_tokens` and take only
 * `max_completion_tokens`; OpenRouter lists both for every model, so the catalog records it here.
 * Why only these are marked: specs/model-providers/output-tokens-parameter.feature.
 */
const OPENAI_REASONING_MODEL = /^openai\/(?:o[1-9]|gpt-(?:[5-9]|[1-9][0-9]+))(?:$|[.:-])/;

/** The parameter a model's entry records, or undefined for the default `max_tokens`. */
export function pickOutputTokensParameter(modelId: string): OutputTokensParameter | undefined {
  return OPENAI_REASONING_MODEL.test(modelId.toLowerCase()) ? "max_completion_tokens" : undefined;
}
