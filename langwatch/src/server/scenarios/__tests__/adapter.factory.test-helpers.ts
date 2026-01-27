/**
 * Test helpers for adapter factory tests.
 *
 * These helpers create factory instances with sensible defaults and allow
 * overriding specific dependencies for testing different scenarios.
 */

import {
  HttpAdapterFactory,
  type AgentLookup,
} from "../adapters/http.adapter.factory";
import {
  PromptAdapterFactory,
  type ModelParamsProvider,
  type PromptLookup,
} from "../adapters/prompt.adapter.factory";

// ============================================================================
// Default Test Data
// ============================================================================

export const DEFAULT_PROMPT = {
  id: "prompt_123",
  prompt: "You are helpful",
  messages: [],
  model: "openai/gpt-4",
  temperature: 0.7,
  maxTokens: 100,
};

export const DEFAULT_MODEL_PARAMS = { api_key: "key", model: "gpt-4" };

export const DEFAULT_HTTP_AGENT = {
  id: "agent_123",
  type: "http" as const,
  config: {
    url: "https://api.example.com",
    method: "POST",
    headers: [],
  },
};

// ============================================================================
// Factory Builders
// ============================================================================

/**
 * Creates a PromptAdapterFactory with default stubs that can be overridden.
 *
 * @example
 * ```ts
 * // Factory with all defaults
 * const factory = createPromptAdapterFactory();
 *
 * // Factory with custom prompt lookup
 * const factory = createPromptAdapterFactory({
 *   promptLookup: { getPromptByIdOrHandle: async () => null },
 * });
 * ```
 */
export function createPromptAdapterFactory(overrides?: {
  promptLookup?: Partial<PromptLookup>;
  modelParamsProvider?: Partial<ModelParamsProvider>;
}): PromptAdapterFactory {
  const promptLookup: PromptLookup = {
    getPromptByIdOrHandle: async () => DEFAULT_PROMPT,
    ...overrides?.promptLookup,
  };
  const modelParamsProvider: ModelParamsProvider = {
    prepare: async () => DEFAULT_MODEL_PARAMS,
    ...overrides?.modelParamsProvider,
  };
  return new PromptAdapterFactory(promptLookup, modelParamsProvider);
}

/**
 * Creates an HttpAdapterFactory with default stubs that can be overridden.
 *
 * @example
 * ```ts
 * // Factory with all defaults
 * const factory = createHttpAdapterFactory();
 *
 * // Factory with agent not found
 * const factory = createHttpAdapterFactory({
 *   agentLookup: { findById: async () => null },
 * });
 * ```
 */
export function createHttpAdapterFactory(overrides?: {
  agentLookup?: Partial<AgentLookup>;
}): HttpAdapterFactory {
  const agentLookup: AgentLookup = {
    findById: async () => DEFAULT_HTTP_AGENT,
    ...overrides?.agentLookup,
  };
  return new HttpAdapterFactory(agentLookup);
}
