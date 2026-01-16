import type { LLMConfig } from "~/optimization_studio/types/dsl";

/**
 * Form representation of LLM config (camelCase)
 * Maps to LLMConfig (snake_case) in DSL format.
 */
export type FormLLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  // Traditional sampling parameters
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  // Other sampling parameters
  seed?: number;
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  // Reasoning model parameters (provider-specific)
  reasoningEffort?: string; // OpenAI
  thinkingLevel?: string; // Gemini
  effort?: string; // Anthropic
  verbosity?: string;
  litellmParams?: Record<string, string>;
};

/**
 * Utility functions for converting between form and DSL LLM config formats
 */
export const LLMConfigFormatUtils = {
  /**
   * Convert form LLM config format (camelCase) to DSL format (snake_case)
   */
  formToDslFormat(formLlm: FormLLMConfig): LLMConfig {
    return {
      model: formLlm.model,
      temperature: formLlm.temperature,
      max_tokens: formLlm.maxTokens,
      // Traditional sampling parameters
      top_p: formLlm.topP,
      frequency_penalty: formLlm.frequencyPenalty,
      presence_penalty: formLlm.presencePenalty,
      // Other sampling parameters
      seed: formLlm.seed,
      top_k: formLlm.topK,
      min_p: formLlm.minP,
      repetition_penalty: formLlm.repetitionPenalty,
      // Reasoning model parameters (provider-specific)
      reasoning_effort: formLlm.reasoningEffort,
      thinkingLevel: formLlm.thinkingLevel,
      effort: formLlm.effort,
      verbosity: formLlm.verbosity,
      litellm_params: formLlm.litellmParams,
    };
  },

  /**
   * Convert DSL LLM config format (snake_case) to form format (camelCase)
   */
  dslToFormFormat(dslLlm: LLMConfig): FormLLMConfig {
    return {
      model: dslLlm.model,
      temperature: dslLlm.temperature,
      maxTokens: dslLlm.max_tokens,
      // Traditional sampling parameters
      topP: dslLlm.top_p,
      frequencyPenalty: dslLlm.frequency_penalty,
      presencePenalty: dslLlm.presence_penalty,
      // Other sampling parameters
      seed: dslLlm.seed,
      topK: dslLlm.top_k,
      minP: dslLlm.min_p,
      repetitionPenalty: dslLlm.repetition_penalty,
      // Reasoning model parameters (provider-specific)
      reasoningEffort: dslLlm.reasoning_effort,
      thinkingLevel: dslLlm.thinkingLevel,
      effort: dslLlm.effort,
      verbosity: dslLlm.verbosity,
      litellmParams: dslLlm.litellm_params,
    };
  },
} as const;
