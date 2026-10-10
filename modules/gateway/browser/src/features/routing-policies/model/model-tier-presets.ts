/**
 * Model tiers: reserved names for model selection that decouple clients from specific models.
 * Tiers are resolved via control-plane-emitted mappings; names are reserved to prevent conflicts.
 * No catalog imports to keep bundle size small.
 */

/**
 * Reserved tier names: complex, reasoning, fast.
 * Kept to three to avoid namespace conflicts; future tiers can extend this.
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
    description: "The strongest model available, for work where quality matters more than cost.",
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
