/**
 * The providers the guided takeover offers, curated and ordered. Every entry
 * goes through the shared credential form, which already knows the fields.
 */

import { modelProviders, findProviderDeprecation } from "@langwatch/model-provider-contract";

/** How the panel connects: a device sign-in, a pasted key, or a key plus a typed model. */
export type GuidedProviderKind = "oauth" | "api-key" | "manual";

export interface GuidedProvider {
  readonly id: string;
  readonly kind: GuidedProviderKind;
  /** The key the model-provider registry and its credential form know. */
  readonly registryKey: keyof typeof modelProviders;
  readonly name: string;
  readonly hint: string;
}

export const GUIDED_PROVIDERS: readonly GuidedProvider[] = [
  {
    id: "codex",
    kind: "oauth",
    registryKey: "openai_codex",
    name: "Codex",
    hint: "Sign in with your ChatGPT account, no API key needed",
  },
  {
    id: "openai",
    kind: "api-key",
    registryKey: "openai",
    name: "OpenAI",
    hint: "Platform API key",
  },
  {
    id: "anthropic",
    kind: "api-key",
    registryKey: "anthropic",
    name: "Anthropic",
    hint: "Console API key",
  },
  {
    id: "gemini",
    kind: "api-key",
    registryKey: "gemini",
    name: "Gemini",
    hint: "AI Studio API key",
  },
  {
    id: "azure",
    kind: "manual",
    registryKey: "azure",
    name: "Azure",
    hint: "Endpoint, key and your deployment name",
  },
  {
    id: "bedrock",
    kind: "manual",
    registryKey: "bedrock",
    name: "Bedrock",
    hint: "IAM credentials and the model id you enabled",
  },
  {
    id: "deepseek",
    kind: "api-key",
    registryKey: "deepseek",
    name: "DeepSeek",
    hint: "Platform API key",
  },
  { id: "groq", kind: "api-key", registryKey: "groq", name: "Groq", hint: "Console API key" },
  {
    id: "custom",
    kind: "manual",
    registryKey: "custom",
    name: "Custom",
    hint: "Any OpenAI-compatible endpoint",
  },
];

/** Every curated provider whose registry key is a live (non-deprecated) LLM entry. */
export function guidedProvidersFor(): GuidedProvider[] {
  return GUIDED_PROVIDERS.filter((provider) => {
    const entry = modelProviders[provider.registryKey];
    return entry.type === "llm" && !findProviderDeprecation(provider.registryKey)[0];
  });
}
