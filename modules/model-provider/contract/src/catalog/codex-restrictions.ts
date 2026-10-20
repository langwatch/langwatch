/** Codex surfaces: Langy + the FAST assists that run through the AI gateway. */

import { featuresByRole, type ModelRole } from "./model-feature-registry.ts";

/** Langy's own conversation model. */
export const LANGY_CHAT_FEATURE_KEY = "langy.chat";

/**
 * The one-token generation Test Connection sends. Not in the feature registry:
 * it names no surface, it asks one row whether it can answer at all.
 */
export const CONNECTION_TEST_FEATURE_KEY = "model_provider.connection_test";

/**
 * FAST features that do NOT run through the AI gateway. Codex is reachable
 * only there (its OAuth session lives at the gateway), and these features hand
 * LiteLLM parameters to the langevals service, which calls the provider itself
 * and so has no road to the codex backend. Allowing codex on them only moves
 * the refusal from model selection to execution.
 *
 * - analytics.topic_clustering_llm: names clusters inside langevals, from
 *   parameters built by `ModelProviderExecutionService.prepare`.
 */
export const CODEX_NON_GATEWAY_FAST_FEATURE_KEYS: readonly string[] = [
  "analytics.topic_clustering_llm",
];

/**
 * Langy plus every FAST-role assist that executes through the gateway: the
 * fast tier IS the "light AI assists" the codex terms cover, so a new fast
 * feature is codex-allowed by construction unless it is listed as non-gateway
 * above. A test pins the expansion.
 */
export const CODEX_ALLOWED_FEATURE_KEYS: readonly string[] = [
  LANGY_CHAT_FEATURE_KEY,
  CONNECTION_TEST_FEATURE_KEY,
  ...featuresByRole("FAST")
    .map((f) => f.key)
    .filter((key) => !CODEX_NON_GATEWAY_FAST_FEATURE_KEYS.includes(key)),
];

export function isCodexAllowedFeature(featureKey: string): boolean {
  return CODEX_ALLOWED_FEATURE_KEYS.includes(featureKey);
}

/**
 * The codex provider's registry key. Also the `gen_ai.provider.name` the AI
 * gateway reports on codex spans, and the vendor prefix on codex model ids.
 */
export const CODEX_PROVIDER_KEY = "openai_codex";

/** Model ids belonging to the codex provider ("openai_codex/..."). */
export function isCodexModel(modelId: string): boolean {
  return modelId.startsWith(`${CODEX_PROVIDER_KEY}/`);
}

/** The model a fresh Codex connection defaults the allowed surfaces to. */
export const CODEX_DEFAULT_MODEL = "openai_codex/gpt-5.6-terra";

/**
 * The one model-vs-feature gate every enforcement point calls: the cascade
 * resolver, defaults write paths, the litellm-params builder, and the
 * pickers. Codex is the only restricted provider today.
 */
export function isModelAllowedForFeature({
  modelId,
  featureKey,
}: {
  modelId: string;
  featureKey: string;
}): boolean {
  if (!isCodexModel(modelId)) return true;
  return isCodexAllowedFeature(featureKey);
}

/**
 * Role-level defaults: a restricted model may sit on LANGY and FAST, the roles
 * that carry the coding-assistant surfaces. Not every FAST feature accepts it
 * (see {@link CODEX_NON_GATEWAY_FAST_FEATURE_KEYS}); those features step over
 * the codex role default at resolution time and resolve their own override,
 * or report the restriction. DEFAULT and EMBEDDINGS carry general inference
 * and stay closed.
 */
export function isModelAllowedAsRoleDefault(modelId: string, role: ModelRole): boolean {
  if (!isCodexModel(modelId)) return true;
  return role === "LANGY" || role === "FAST";
}
