import type { LLMConfig } from "~/optimization_studio/types/dsl";

/**
 * Form representation of LLM config (camelCase)
 */
export type FormLLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
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
      litellmParams: dslLlm.litellm_params,
    };
  },
} as const;
