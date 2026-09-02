/**
 * The whole of the model-tier feature on the wire.
 *
 * A tier arrives at the gateway as an ordinary entry in `model_aliases`, which
 * the resolver already looks up by exact name, so the data plane needs no
 * knowledge of tiers at all. All the control plane adds is this: fill in the
 * reserved tier names the policy did not name a target for, from the policy's
 * default model.
 */
import { MODEL_TIERS } from "./gateway-model-tier-presets.adapter";

/**
 * Returns the model name mapping the gateway receives.
 *
 * The fallthrough applies to the reserved tier names and to nothing else.
 * Extending it to unrecognized models would serve a caller a model they never
 * named, bill every typo, and make `models_allowed` unenforceable, because a
 * request would always resolve to something instead of reaching the rejection.
 *
 * A tier with neither an explicit target nor a default model is left out
 * entirely, so it stays an unknown model name rather than becoming a reserved
 * word that fails in some new way.
 */
export function withTierFallthrough({
  aliases,
  defaultModel,
}: {
  aliases: Record<string, string>;
  defaultModel: string | null;
}): Record<string, string> {
  if (!defaultModel) return aliases;
  const withTiers = { ...aliases };
  for (const tier of MODEL_TIERS) {
    if (!withTiers[tier]) withTiers[tier] = defaultModel;
  }
  return withTiers;
}
