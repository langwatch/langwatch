/**
 * LLM Config Builder
 *
 * Builds LLMConfig objects for the DSL execution layer from various input sources
 * (VersionedPrompt, LocalPromptConfig, form values).
 *
 * This is the single source of truth for converting application-layer LLM configs
 * (camelCase) to DSL-layer configs (snake_case) ready for Python backend execution.
 *
 * Used by:
 * - Evaluations V3 workflow builder
 * - Copilotkit service adapter (prompt playground)
 * - Any other execution entry points
 */

import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { mapReasoningToProvider } from "./reasoningBoundary";

/**
 * Input type for building LLM config - accepts camelCase fields
 * (from VersionedPrompt, LocalPromptConfig, or form values)
 */
export interface LLMConfigInput {
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
}

/**
 * Builds a complete LLM config from camelCase input, ready for the Python backend.
 *
 * The function:
 * 1. Converts camelCase to snake_case for Python compatibility
 * 2. Maps the unified 'reasoning' field to 'reasoning_effort' via mapReasoningToProvider
 * 3. Includes all sampling parameters
 *
 * @param input - LLM config in camelCase format
 * @returns LLM config in snake_case format ready for Python backend (DSL LLMConfig type)
 *
 * @example
 * const config = buildLLMConfig({
 *   model: "openai/gpt-5",
 *   temperature: 0.7,
 *   maxTokens: 4096,
 *   reasoning: "high",
 * });
 * // Returns: { model: "openai/gpt-5", temperature: 0.7, max_tokens: 4096, reasoning_effort: "high" }
 */
export function buildLLMConfig(input: LLMConfigInput): LLMConfig {
  const reasoningMapped = mapReasoningToProvider(input.model, input.reasoning);

  return {
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
    // Spread the mapped reasoning (e.g., { reasoning_effort: "high" })
    ...reasoningMapped,
    verbosity: input.verbosity,
    litellm_params: input.litellmParams,
  };
}
