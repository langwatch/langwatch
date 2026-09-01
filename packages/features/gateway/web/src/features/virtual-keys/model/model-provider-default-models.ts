/**
 * The model a provider is assumed to serve when nobody has said otherwise.
 *
 * The onboarding registry (`platform/app/src/features/onboarding/regions/model-providers/registry.tsx`)
 * carries this alongside icons, credential editors, base URLs and a dozen other
 * things a virtual key has no use for, and it is an application module a
 * feature-web package may not import. One column of it travels: the provider key
 * and the model its entry names as the default.
 *
 * NOT EVERY PROVIDER HAS ONE, and the absent ones are absent in the registry
 * too — a self-hosted `custom` endpoint, Bedrock, Groq, Vertex AI and Cerebras
 * all name their models per deployment, so the caller falls through to the
 * provider's own first model. Adding a key here that the registry does not
 * carry would invent a default rather than copy one.
 *
 * The two lists must agree, and today nothing enforces that; a registry default
 * that changes and is not changed here makes a new key name a model one version
 * behind. It resolves when the registry itself becomes a contract.
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
