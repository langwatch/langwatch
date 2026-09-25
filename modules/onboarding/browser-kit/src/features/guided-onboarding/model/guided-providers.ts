/**
 * The providers the guided takeover offers, curated and ordered. Every entry
 * goes through the shared credential form, which already knows the fields.
 */

import { modelProviders, findProviderDeprecation } from "@langwatch/model-provider-contract";

export interface GuidedProvider {
  readonly id: string;
  /** The key the model-provider registry and its credential form know. */
  readonly registryKey: keyof typeof modelProviders;
  readonly name: string;
  readonly hint: string;
}

export const GUIDED_PROVIDERS: readonly GuidedProvider[] = [
  {
    id: "codex",
    registryKey: "openai_codex",
    name: "Codex",
    hint: "Sign in with your ChatGPT account, no API key needed",
  },
  { id: "openai", registryKey: "openai", name: "OpenAI", hint: "Platform API key" },
  { id: "anthropic", registryKey: "anthropic", name: "Anthropic", hint: "Console API key" },
  { id: "gemini", registryKey: "gemini", name: "Gemini", hint: "AI Studio API key" },
  {
    id: "azure",
    registryKey: "azure",
    name: "Azure",
    hint: "Endpoint, key and your deployment name",
  },
  {
    id: "bedrock",
    registryKey: "bedrock",
    name: "Bedrock",
    hint: "IAM credentials and the model id you enabled",
  },
  { id: "deepseek", registryKey: "deepseek", name: "DeepSeek", hint: "Platform API key" },
  { id: "groq", registryKey: "groq", name: "Groq", hint: "Console API key" },
  { id: "custom", registryKey: "custom", name: "Custom", hint: "Any OpenAI-compatible endpoint" },
];

/** Every curated provider whose registry key is a live (non-deprecated) LLM entry. */
export function guidedProvidersFor(): GuidedProvider[] {
  return GUIDED_PROVIDERS.filter((provider) => {
    const entry = modelProviders[provider.registryKey];
    return entry.type === "llm" && !findProviderDeprecation(provider.registryKey)[0];
  });
}
