/**
 * Where Codex models are allowed to run.
 *
 * The Codex provider bills the user's ChatGPT plan through OpenAI's codex
 * backend, whose terms license it for coding-assistant harnesses and light
 * AI assists — not general inference. The rule: Langy itself plus the FAST
 * tier's assists. Everything else (prompt playground, evaluations,
 * workflows, batch runs) must neither offer nor accept a codex model.
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
 * The rule, not a hand-kept list: Langy itself plus every FAST-role assist.
 * The fast tier IS the "light AI assists" the codex terms cover, so a new
 * fast feature is codex-allowed by construction — while DEFAULT (playground,
 * evaluators, workflows) and EMBEDDINGS stay out. A test pins the expansion
 * so the set never widens silently.
 */
export const CODEX_ALLOWED_FEATURE_KEYS: readonly string[] = [
  LANGY_CHAT_FEATURE_KEY,
  ...featuresByRole("FAST").map((f) => f.key),
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
 * Role-level defaults apply across every feature in the role at once, so a
 * restricted model may only sit on a role whose ENTIRE feature set is
 * codex-allowed: LANGY (Langy's own role) and FAST (the assists). DEFAULT
 * and EMBEDDINGS carry general-inference surfaces and stay closed.
 */
export function isModelAllowedAsRoleDefault(
  modelId: string,
  role: ModelRole,
): boolean {
  if (!isCodexModel(modelId)) return true;
  return role === "LANGY" || role === "FAST";
}
