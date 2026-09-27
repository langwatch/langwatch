/**
 * Where Codex models are allowed to run.
 *
 * The Codex provider bills the user's ChatGPT plan through OpenAI's codex
 * backend, whose terms license it for coding-assistant harnesses and light
 * AI assists — not general inference. The rule: Langy itself plus the FAST
 * tier's assists, minus the few FAST features that never actually execute
 * through codex's one execution road (the AI gateway Responses endpoint).
 * Everything else (prompt playground, evaluations, workflows, batch runs)
 * must neither offer nor accept a codex model.
 *
 * FAST stays a legal role for a codex default — the Codex connect flows write
 * FAST=codex on purpose. A FAST feature that codex cannot actually run is
 * excluded from the allowed FEATURE set instead, so the cascade resolver skips
 * the codex value per-feature and keeps walking the scope chain (project →
 * team → organization), raising ModelRestrictedForFeatureError if no other
 * configured value exists — it never substitutes a model or falls back to
 * another role, and the role is not closed wholesale (see
 * CODEX_EXCLUDED_FAST_FEATURE_KEYS).
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

import { featuresByRole, type ModelRole } from "./featureRegistry";

/** Langy's own conversation model. */
export const LANGY_CHAT_FEATURE_KEY = "langy.chat";

/**
 * The one-token generation Test Connection sends.
 *
 * Not a feature anyone configures a model for, and not in the feature
 * registry: it names no surface and offers no choice, it asks the row the
 * reader is looking at whether it can answer at all. Codex-allowed because a
 * connection check is the lightest assist there is, and because the
 * alternative is a provider the customer cannot test.
 */
export const CONNECTION_TEST_FEATURE_KEY = "model_provider.connection_test";

/**
 * FAST features that a codex default must NOT license, even though they sit
 * in the FAST tier.
 *
 * Topic clustering is a FAST feature, but it executes via `prepareLitellmParams`
 * (langevals/litellm), whose codex backstop refuses codex models outright —
 * codex's only execution road is the AI gateway Responses endpoint, which
 * topic clustering never uses. Licensing the model at RESOLUTION while
 * refusing it at EXECUTION produced a daily silent failure: scheduled
 * clustering resolved FAST=codex, then threw at the litellm layer with a
 * customer-hostile "coding-assistant surfaces only" message (issue #8287).
 * Excluding it here makes the cascade resolver skip the codex value and keep
 * walking the scope chain (project → team → organization) for this feature,
 * raising ModelRestrictedForFeatureError when no other configured value exists
 * rather than resolving FAST=codex.
 */
export const CODEX_EXCLUDED_FAST_FEATURE_KEYS: readonly string[] = [
  "analytics.topic_clustering_llm",
];

/**
 * The rule, not a hand-kept list: Langy itself plus every FAST-role assist,
 * minus the FAST features codex cannot actually execute
 * (CODEX_EXCLUDED_FAST_FEATURE_KEYS). The fast tier IS the "light AI assists"
 * the codex terms cover, so a new fast feature is codex-allowed by
 * construction — while DEFAULT (playground, evaluators, workflows) and
 * EMBEDDINGS stay out. A test pins the expansion so the set never widens
 * silently.
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
 * resolver (skips disallowed values), the defaults write paths (reject
 * saving them), the litellm-params builder (rejects execution), and the
 * pickers (hide the options). Codex is the only restricted provider today.
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
 * Whether a codex model may be SAVED as a role default. LANGY (Langy's own
 * role) and FAST (the assists) are legal — the Codex connect flows write
 * FAST=codex on purpose. DEFAULT and EMBEDDINGS carry general-inference
 * surfaces and stay closed.
 *
 * This is deliberately a role-wide "yes" for FAST even though a few FAST
 * features cannot run codex (CODEX_EXCLUDED_FAST_FEATURE_KEYS): those are
 * skipped per-feature by the cascade resolver via `isModelAllowedForFeature`,
 * so the default stays writable while the resolver skips the codex value for
 * the unrunnable feature and walks the scope chain (raising
 * ModelRestrictedForFeatureError if no other configured value exists), rather
 * than closing the whole role.
 */
export function isModelAllowedAsRoleDefault(
  modelId: string,
  role: ModelRole,
): boolean {
  if (!isCodexModel(modelId)) return true;
  return role === "LANGY" || role === "FAST";
}
