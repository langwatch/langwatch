import { mapReasoningToProvider } from "@langwatch/prompt-contract";

import {
  llmConfigSchema,
  type LLMConfig,
  type LocalPromptLlmConfig,
} from "./studio-workflow";

export type SupportedLlmParameter = string;

/**
 * Convert the editor's camel-case LLM settings to the execution DSL shape.
 * Unknown models keep the legacy unfiltered behaviour when no allowlist is
 * supplied. An explicit empty allowlist still removes sampling parameters.
 */
export function buildWorkflowLlmConfig(
  input: LocalPromptLlmConfig,
  supportedParameters?: readonly SupportedLlmParameter[] | null,
): LLMConfig {
  const full: LLMConfig = {
    model: input.model,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    top_p: input.topP,
    frequency_penalty: input.frequencyPenalty,
    presence_penalty: input.presencePenalty,
    seed: input.seed,
    top_k: input.topK,
    min_p: input.minP,
    repetition_penalty: input.repetitionPenalty,
    ...mapReasoningToProvider(input.model, input.reasoning),
    verbosity: input.verbosity,
    litellm_params: input.litellmParams,
  };

  if (supportedParameters === void 0 || supportedParameters === null) {
    return full;
  }

  const allowed = new Set(supportedParameters);
  allowed.add("max_tokens");

  if (allowed.has("reasoning")) {
    allowed.add("reasoning_effort");
    allowed.add("thinkingLevel");
    allowed.add("effort");
  }

  const filtered = Object.fromEntries(
    Object.entries(full).filter(([key]) => {
      return key === "model" || key === "litellm_params" || allowed.has(key);
    }),
  );

  return llmConfigSchema.parse(filtered);
}
