/**
 * Canonical default model for each LLM provider.
 *
 * This is the single source of truth for per-provider defaults. Providers that
 * have no meaningful default (Bedrock, Groq, Vertex AI, Cerebras) are omitted
 * intentionally — resolveDefaultModel skips them and moves to the next enabled
 * provider rather than returning a null model.
 *
 * The keys match the server-side registry keys in `src/server/modelProviders/registry.ts`.
 * The values are fully-qualified model IDs in the "provider/model" wire format.
 *
 * Update this map whenever a provider's recommended default model changes;
 * the onboarding registry.tsx imports from here to stay in sync.
 */
export const PROVIDER_DEFAULT_MODELS: Partial<Record<string, string>> = {
  openai: "openai/gpt-5.2",
  anthropic: "anthropic/claude-sonnet-4-5",
  gemini: "gemini/gemini-2.5-flash",
  azure: "azure/gpt-5",
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
 * When no project.defaultModel is set, resolveDefaultModel walks this list
 * and returns the first enabled provider's canonical model. The order
 * matches the onboarding registry.tsx display order so the UX is consistent.
 */
export const PROVIDER_RESOLUTION_ORDER: string[] = [
  "openai",
  "anthropic",
  "gemini",
  "azure",
  "deepseek",
  "xai",
];
