/**
 * What the embedded provider setup (Langy's "needs a model" panel) shows beside the credentials:
 * the provider's heading name, where it documents its keys, and which providers pick from the
 * registry's model list rather than adding their own models first.
 */

const PROVIDER_DOCS: Record<string, string> = {
  openai_codex: "https://chatgpt.com/codex",
  openai: "https://platform.openai.com/docs/overview",
  anthropic: "https://docs.anthropic.com/",
  gemini: "https://ai.google.dev/",
  azure: "https://learn.microsoft.com/azure/ai-services/openai/",
  bedrock: "https://aws.amazon.com/bedrock/",
  deepseek: "https://www.deepseek.com/",
  groq: "https://groq.com/",
  xai: "https://x.ai/",
  vertex_ai: "https://cloud.google.com/vertex-ai",
  cerebras: "https://cerebras.ai/",
};

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  azure: "Azure OpenAI",
  bedrock: "AWS Bedrock",
  xai: "Grok (xAI)",
  vertex_ai: "Google Vertex AI",
  custom: "Custom, OpenAI-compatible",
};

const PROVIDERS_WITH_WELL_KNOWN_MODELS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "xai",
]);

export const LANGWATCH_INTRODUCTION_DOCS = "https://docs.langwatch.ai/introduction";

export function findProviderDocsUrl(providerKey: string): string | undefined {
  return PROVIDER_DOCS[providerKey];
}

export function hasWellKnownModels(providerKey: string): boolean {
  return PROVIDERS_WITH_WELL_KNOWN_MODELS.has(providerKey);
}

export function embeddedProviderLabel({
  providerKey,
  providerName,
}: {
  providerKey: string;
  providerName: string;
}): string {
  return PROVIDER_LABELS[providerKey] ?? providerName;
}
