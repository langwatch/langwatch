import { llmModels } from "./model-catalog";
import { resolveLatestAlias } from "./latest-aliases";
import type { LLMModelEntry } from "./model-catalog.types";

const MODEL_TIERS = ["complex", "reasoning", "fast"] as const;
type ModelTier = (typeof MODEL_TIERS)[number];

function isModelTier(name: string): name is ModelTier {
  return MODEL_TIERS.includes(name as ModelTier);
}

export interface TierTargetSuggestion {
  modelId: string;
  name: string;
  provider: string;
  recommended?: boolean;
}

export interface SuggestTierTargetsInput {
  tier: ModelTier;
  boundProviderTypes?: readonly string[];
  limit?: number;
}

const DEFAULT_LIMIT = 8;
const FLAGSHIP_ALIASES = ["openai/latest", "anthropic/latest", "gemini/latest"] as const;
const FAST_ALIASES = ["openai/latest-mini", "anthropic/latest-mini", "gemini/latest-mini"] as const;
const REASONING_PARAMETERS = ["reasoning", "reasoning_effort"];

function isChatModel(entry: LLMModelEntry): boolean {
  if (entry.mode !== "chat") return false;
  const output = entry.modality.split("->")[1];
  return !output || output.split("+").includes("text");
}

function supportsReasoning(entry: LLMModelEntry): boolean {
  return REASONING_PARAMETERS.some((parameter) => entry.supportedParameters.includes(parameter));
}

function blendedCostPerToken(entry: LLMModelEntry): number | null {
  const pricing = entry.pricing;
  if (!pricing) return null;
  const input = pricing.inputCostPerToken ?? 0;
  const output = pricing.outputCostPerToken ?? 0;
  if (input <= 0 || output <= 0) return null;
  return input * 0.75 + output * 0.25;
}

export function isRankableByPrice(entry: LLMModelEntry): boolean {
  return blendedCostPerToken(entry) !== null;
}

function priceOf(entry: LLMModelEntry): number {
  return blendedCostPerToken(entry) ?? 0;
}

function providerAllowed(
  entry: LLMModelEntry,
  boundProviderTypes: readonly string[] | undefined,
): boolean {
  return (
    !boundProviderTypes ||
    boundProviderTypes.length === 0 ||
    boundProviderTypes.includes(entry.provider)
  );
}

function toSuggestion(entry: LLMModelEntry): TierTargetSuggestion {
  return { modelId: entry.id, name: entry.name ?? entry.id, provider: entry.provider };
}

function resolvedAliasIds(aliases: readonly string[]): string[] {
  const ids: string[] = [];
  for (const alias of aliases) {
    const resolved = resolveLatestAlias(alias);
    if (resolved && !ids.includes(resolved)) ids.push(resolved);
  }
  return ids;
}

function tierOrderedRest(
  tier: ModelTier,
  catalog: LLMModelEntry[],
  exclude: ReadonlySet<string>,
): LLMModelEntry[] {
  const candidates = catalog.filter((entry) => !exclude.has(entry.id)).filter(isRankableByPrice);
  if (tier === "reasoning") {
    return candidates.filter(supportsReasoning).sort((a, b) => priceOf(b) - priceOf(a));
  }
  if (tier === "fast") {
    return candidates.sort((a, b) => priceOf(a) - priceOf(b));
  }
  return candidates.sort(
    (a, b) => priceOf(b) - priceOf(a) || (b.contextLength ?? 0) - (a.contextLength ?? 0),
  );
}

export function suggestTierTargets({
  tier,
  boundProviderTypes,
  limit = DEFAULT_LIMIT,
}: SuggestTierTargetsInput): TierTargetSuggestion[] {
  const catalog = Object.values(llmModels.models).filter(
    (entry) => isChatModel(entry) && providerAllowed(entry, boundProviderTypes),
  );
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const aliases = tier === "fast" ? FAST_ALIASES : FLAGSHIP_ALIASES;
  const leadingIds = resolvedAliasIds(aliases).filter((id) => byId.has(id));
  const rest = tierOrderedRest(tier, catalog, new Set(leadingIds));
  const ordered = [...leadingIds]
    .map((id) => byId.get(id))
    .filter((entry): entry is LLMModelEntry => entry !== undefined)
    .concat(rest)
    .map(toSuggestion);
  if (ordered[0]) ordered[0].recommended = true;
  return ordered.slice(0, limit);
}

export function isKnownModelId(modelId: string): boolean {
  return Boolean(llmModels.models[modelId]);
}

export function partitionTierAliases(modelAliases: Record<string, string>): {
  tiers: Partial<Record<ModelTier, string>>;
  names: Record<string, string>;
} {
  const tiers: Partial<Record<ModelTier, string>> = {};
  const names: Record<string, string> = {};
  for (const [from, to] of Object.entries(modelAliases)) {
    if (isModelTier(from)) tiers[from] = to;
    else names[from] = to;
  }
  return { tiers, names };
}
