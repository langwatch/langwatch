/**
 * The model a provider is assumed to serve, copied from the onboarding
 * registry. Not every provider has one; self-hosted, Bedrock, Groq, and
 * similar providers rely on their first model instead.
 */

export const MODEL_PROVIDER_DEFAULT_MODELS: Readonly<Record<string, string>> = {
  openai: "gpt-5.2",
  openai_codex: "gpt-5.6-terra",
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.5-flash",
  azure: "gpt-5",
  deepseek: "deepseek-r1",
  xai: "grok-4",
};
