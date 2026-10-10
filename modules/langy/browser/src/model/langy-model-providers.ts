/**
 * Which providers Langy offers inline when a project has none, in main's order: Codex leads,
 * since a reader who already pays for ChatGPT gets a working model without pasting a key, and
 * Custom closes the row. A provider the registry drops or deprecates drops out here too.
 */
import { modelProviders, findProviderDeprecation } from "@langwatch/model-provider-contract";

export const LANGY_RECOMMENDED_PROVIDER = "openai_codex";

const LANGY_PROVIDERS: readonly { provider: string; label: string }[] = [
  { provider: "openai_codex", label: "Codex (OpenAI account)" },
  { provider: "openai", label: "OpenAI" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "gemini", label: "Google Gemini" },
  { provider: "azure", label: "Azure OpenAI" },
  { provider: "bedrock", label: "AWS Bedrock" },
  { provider: "deepseek", label: "DeepSeek" },
  { provider: "groq", label: "Groq" },
  { provider: "xai", label: "Grok (xAI)" },
  { provider: "vertex_ai", label: "Google Vertex AI" },
  { provider: "cerebras", label: "Cerebras" },
  { provider: "custom", label: "Custom, OpenAI-compatible" },
];

export const LANGY_MODEL_SETUP_DESCRIPTION =
  "Langy uses this model to chat with you and help you work across the platform.";

export type LangyModelProvider = {
  readonly provider: string;
  readonly name: string;
  readonly recommended: boolean;
};

export function langyModelProviders(): LangyModelProvider[] {
  return LANGY_PROVIDERS.filter(
    ({ provider }) => provider in modelProviders && !findProviderDeprecation(provider)[0],
  ).map(({ provider, label }) => ({
    provider,
    name: label,
    recommended: provider === LANGY_RECOMMENDED_PROVIDER,
  }));
}
