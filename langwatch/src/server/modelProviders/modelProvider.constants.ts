/**
 * Canonical default model for each LLM provider.
 *
 * Single source of truth for per-provider defaults used when
 * project.defaultModel is null or its provider is disabled.
 * Providers without a predictable canonical default (Bedrock, Groq,
 * Vertex AI, Cerebras, Custom) are intentionally omitted — the resolver
 * skips them and falls through to the next enabled provider.
 *
 * Keys match server-side registry keys in registry.ts.
 * For openai/anthropic/gemini the "latest" alias is used so the
 * default tracks upstream releases automatically (resolved at call-time
 * by latestAliases.ts); other providers use pinned concrete IDs.
 *
 * Update this map when a provider's recommended default changes.
 */
export const PROVIDER_DEFAULT_MODELS: Partial<Record<string, string>> = {
  openai: "openai/latest",
  anthropic: "anthropic/latest",
  gemini: "gemini/latest",
  azure: "azure/gpt-4o",
  deepseek: "deepseek/deepseek-r1",
  xai: "xai/grok-4",
  // bedrock: omitted — no single canonical default model
  // groq: omitted — no single canonical default model
  // vertex_ai: omitted — no single canonical default model
  // cerebras: omitted — no single canonical default model
  // custom: omitted — user-defined endpoint, default is unknowable
};

/**
 * Provider keys in preferred iteration order for default-model resolution.
 *
 * resolveDefaultModel walks this list and returns the first enabled
 * provider's canonical model when no project-level override is set.
 * Order matches the onboarding registry display order for UX consistency.
 */
export const PROVIDER_RESOLUTION_ORDER: readonly string[] = [
  "openai",
  "anthropic",
  "gemini",
  "azure",
  "deepseek",
  "xai",
];
