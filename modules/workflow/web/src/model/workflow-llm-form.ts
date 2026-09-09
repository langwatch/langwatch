import { normalizeReasoningFromProviderFields } from "@langwatch/prompt-contract";
import type { LLMConfig } from "@langwatch/workflow-contract";

/** Browser form representation of the workflow DSL's LLM config. */
export type FormLLMConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  topK?: number;
  minP?: number;
  repetitionPenalty?: number;
  reasoning?: string;
  verbosity?: string;
  litellmParams?: Record<string, string>;
};

export const LLMConfigFormatUtils = {
  formToDslFormat(formLlm: FormLLMConfig): LLMConfig {
    return {
      model: formLlm.model,
      temperature: formLlm.temperature,
      max_tokens: formLlm.maxTokens,
      top_p: formLlm.topP,
      frequency_penalty: formLlm.frequencyPenalty,
      presence_penalty: formLlm.presencePenalty,
      seed: formLlm.seed,
      top_k: formLlm.topK,
      min_p: formLlm.minP,
      repetition_penalty: formLlm.repetitionPenalty,
      reasoning: formLlm.reasoning,
      verbosity: formLlm.verbosity,
      litellm_params: formLlm.litellmParams,
    };
  },

  dslToFormFormat(dslLlm: LLMConfig): FormLLMConfig {
    const reasoning = normalizeReasoningFromProviderFields(dslLlm);

    return {
      model: dslLlm.model,
      temperature: dslLlm.temperature,
      maxTokens: dslLlm.max_tokens,
      topP: dslLlm.top_p,
      frequencyPenalty: dslLlm.frequency_penalty,
      presencePenalty: dslLlm.presence_penalty,
      seed: dslLlm.seed,
      topK: dslLlm.top_k,
      minP: dslLlm.min_p,
      repetitionPenalty: dslLlm.repetition_penalty,
      reasoning,
      verbosity: dslLlm.verbosity,
      litellmParams: dslLlm.litellm_params,
    };
  },
} as const;
