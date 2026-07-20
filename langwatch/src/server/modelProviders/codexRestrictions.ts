/**
 * Where Codex models are allowed to run.
 *
 * The Codex provider bills the user's ChatGPT plan through OpenAI's codex
 * backend, whose terms license it for coding-assistant harnesses and light
 * AI assists — not general inference. This list is the single definition of
 * "allowed": Langy itself plus the small assists around the UI. Everything
 * else (prompt playground, evaluations, workflows, scenario/dataset
 * generation, batch runs) must neither offer nor accept a codex model.
 *
 * Consumed by:
 *   - the provider registry entry (`restrictedToFeatureKeys`),
 *   - resolveModelForFeature (rejects restricted models on other features),
 *   - modelDefaults.service (rejects saving them on other feature slots),
 *   - prepareLitellmParams (rejects execution outside these features),
 *   - the frontend pickers (hide codex models elsewhere).
 *
 * Spec: specs/model-providers/codex-account-provider.feature
 */

/** Langy's own conversation model. */
export const LANGY_CHAT_FEATURE_KEY = "langy.chat";

export const CODEX_ALLOWED_FEATURE_KEYS = [
  LANGY_CHAT_FEATURE_KEY,
  // The tiny assists around the UI.
  "traces.ai_search",
  "langy.conversation_title",
  "workflows.commit_message",
  "studio.autocomplete",
  "translate.text",
] as const;

export type CodexAllowedFeatureKey =
  (typeof CODEX_ALLOWED_FEATURE_KEYS)[number];

export function isCodexAllowedFeature(featureKey: string): boolean {
  return (CODEX_ALLOWED_FEATURE_KEYS as readonly string[]).includes(featureKey);
}

/** Model ids belonging to the codex provider ("openai_codex/..."). */
export function isCodexModel(modelId: string): boolean {
  return modelId.startsWith("openai_codex/");
}

/** The model a fresh Codex connection defaults the allowed surfaces to. */
export const CODEX_DEFAULT_MODEL = "openai_codex/gpt-5.6-terra";
