/** Codex surfaces: Langy + FAST assists only. */

import { featuresByRole, type ModelRole } from "./model-feature-registry.ts";

/** Langy's own conversation model. */
export const LANGY_CHAT_FEATURE_KEY = "langy.chat";

/**
 * The one-token generation Test Connection sends. Not in the feature registry:
 * it names no surface, it asks one row whether it can answer at all.
 */
export const CONNECTION_TEST_FEATURE_KEY = "model_provider.connection_test";

/**
 * FAST features a codex default must NOT license, even though they sit in the
 * FAST tier.
 *
 * Topic clustering executes through langevals/litellm, whose codex backstop
 * refuses codex models outright; codex's only execution road is the AI gateway
 * Responses endpoint, which clustering never uses. Licensing the model at
 * RESOLUTION while refusing it at EXECUTION would fail late with a
 * customer-hostile message. Excluding it here makes the cascade resolver skip
 * the codex value and keep walking the scope chain, raising
 * ModelRestrictedForFeatureError when no other configured value exists.
 */
export const CODEX_EXCLUDED_FAST_FEATURE_KEYS: readonly string[] = [
  "analytics.topic_clustering_llm",
];

/**
 * The rule, not a hand-kept list: Langy plus every FAST-role assist, minus the
 * FAST features codex cannot execute (CODEX_EXCLUDED_FAST_FEATURE_KEYS) — the
 * fast tier IS the "light AI assists" the codex terms cover, so a new fast
 * feature is codex-allowed by construction. A test pins the expansion.
 */
export const CODEX_ALLOWED_FEATURE_KEYS: readonly string[] = [
  LANGY_CHAT_FEATURE_KEY,
  CONNECTION_TEST_FEATURE_KEY,
  ...featuresByRole("FAST")
    .map((f) => f.key)
    .filter((key) => !CODEX_EXCLUDED_FAST_FEATURE_KEYS.includes(key)),
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
 * Whether a codex model may be SAVED as a role default: LANGY and FAST (the
 * Codex connect flows write FAST=codex on purpose). DEFAULT and EMBEDDINGS
 * carry general inference and stay closed.
 *
 * FAST is a role-wide "yes" even though a few FAST features cannot run codex
 * (CODEX_EXCLUDED_FAST_FEATURE_KEYS): the resolver skips the codex value
 * per-feature via `isModelAllowedForFeature` instead of closing the role.
 */
export function isModelAllowedAsRoleDefault(modelId: string, role: ModelRole): boolean {
  if (!isCodexModel(modelId)) return true;
  return role === "LANGY" || role === "FAST";
}
