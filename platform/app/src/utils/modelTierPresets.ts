/**
 * Model tiers: the reserved names a caller may send as `model` instead of
 * naming a specific model, so a client written once keeps working when the
 * organization moves to a newer model.
 *
 * A tier is an ordinary entry in a routing policy's model name mapping. The
 * gateway resolver needs no knowledge of it: the control plane emits
 * `tier -> the model the tier points at` alongside every other mapping, and
 * the resolver looks it up like any other name. What makes a tier different
 * is only that the names below are reserved, presented in the product as a
 * first-class choice, and fall through to the policy's default model when the
 * policy names no target for them.
 *
 * That fallthrough is deliberately limited to these names. A catch-all would
 * serve a caller a model they never asked for, turn every typo into a billed
 * call, and make an allowlist unenforceable, because nothing would ever reach
 * the rejection.
 *
 * Kept free of any catalog import: this is what the browser bundle uses, and
 * the model catalog is 441 KB. Ranked suggestions per tier live server-side in
 * `@langwatch/model-provider-server`'s tier-target adapter.
 */

/**
 * The reserved tier names, in the order they are presented.
 *
 * Three rather than four. A "simple" tier alongside "fast" reads as a synonym
 * in the product and resolves to the same small model in every real catalog,
 * while permanently taking one more name out of the caller's namespace. A
 * fourth tier is additive later; taking one away once callers script against
 * it is not.
 */
export const MODEL_TIERS = ["complex", "reasoning", "fast"] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

const TIER_SET: ReadonlySet<string> = new Set<string>(MODEL_TIERS);

/** Whether a model name is one of the reserved tier names. */
export function isModelTier(name: string): name is ModelTier {
  return TIER_SET.has(name);
}

export interface ModelTierPreset {
  tier: ModelTier;
  /**
   * What the tier means to the person choosing it. Capability, never speed:
   * "fast" and "cheap" describe the same models from two angles, so labelling
   * by speed makes neighbouring tiers read as synonyms.
   */
  label: string;
  /** One line of help, shown under the label. */
  description: string;
}

export const MODEL_TIER_PRESETS: readonly ModelTierPreset[] = [
  {
    tier: "complex",
    label: "Most capable",
    description:
      "The strongest model available, for work where quality matters more than cost.",
  },
  {
    tier: "reasoning",
    label: "Best at step-by-step reasoning",
    description:
      "A model that works through a problem before answering, for planning, analysis and hard debugging.",
  },
  {
    tier: "fast",
    label: "Quick and inexpensive",
    description:
      "A small model for high volume work: classification, extraction, routing and short replies.",
  },
] as const;

const PRESET_BY_TIER = new Map<ModelTier, ModelTierPreset>(
  MODEL_TIER_PRESETS.map((preset) => [preset.tier, preset]),
);

export function modelTierPreset(tier: ModelTier): ModelTierPreset {
  const preset = PRESET_BY_TIER.get(tier);
  if (!preset) {
    throw new Error(`no preset for model tier: ${tier}`);
  }
  return preset;
}

/**
 * The example request a caller sends once a tier is configured, shown in the
 * product next to the tier editor so the payoff is visible while choosing.
 */
export function modelTierRequestSnippet(tier: ModelTier): string {
  return JSON.stringify({ model: tier }, null, 2);
}
