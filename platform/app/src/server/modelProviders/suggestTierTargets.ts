/**
 * Ranked candidate models per tier, read from the model catalog.
 *
 * Server-side because it imports the catalog, which the browser bundle must
 * never pull in. The tier names, labels and the reserved-name rule live in
 * `utils/modelTierPresets.ts`, which is safe to import from anywhere.
 *
 * These are suggestions offered in the product, never something the gateway
 * consults. The stored value is always a concrete model id: writing a moving
 * name like `openai/latest` into a policy would make the gateway dispatch a
 * model literally called `latest`.
 */
import { isModelTier, type ModelTier } from "~/utils/modelTierPresets";
import { resolveLatestAlias } from "./latestAliases";
import type { LLMModelEntry } from "./llmModels.types";
import { llmModels } from "./loadModelCatalog";

/** One model offered as a target for a tier. */
export interface TierTargetSuggestion {
  /** Concrete model id, provider-qualified, exactly as it is stored. */
  modelId: string;
  /** The catalog's display name. */
  name: string;
  /** ModelProvider type this model is served by, for filtering by binding. */
  provider: string;
  /**
   * Set on the one candidate the product pre-selects. Every other candidate
   * is an equally valid manual choice.
   */
  recommended?: boolean;
}

export interface SuggestTierTargetsInput {
  tier: ModelTier;
  /**
   * Provider types the policy is actually bound to (`openai`, `anthropic`,
   * ...). A suggestion the organization cannot reach is worse than no
   * suggestion: picking it produces a key that fails on its first call.
   * Empty means no filtering.
   */
  boundProviderTypes?: readonly string[];
  /** How many candidates to return. */
  limit?: number;
}

const DEFAULT_LIMIT = 8;

/**
 * The flagship pick per provider, expressed through the same latest-alias
 * resolver the model-provider drawer uses, so a tier and a role default
 * pre-fill with the same model rather than two functions disagreeing about
 * what "newest" means.
 */
const FLAGSHIP_ALIASES = [
  "openai/latest",
  "anthropic/latest",
  "gemini/latest",
] as const;

/** The small, inexpensive pick per provider, same resolver. */
const FAST_ALIASES = [
  "openai/latest-mini",
  "anthropic/latest-mini",
  "gemini/latest-mini",
] as const;

/**
 * Parameters that mean the model reasons before answering. The catalog
 * reports what a model accepts rather than how it behaves, and this is the
 * closest honest signal it carries.
 */
const REASONING_PARAMETERS = ["reasoning", "reasoning_effort"];

function isChatModel(entry: LLMModelEntry): boolean {
  return entry.mode === "chat";
}

function supportsReasoning(entry: LLMModelEntry): boolean {
  const supported = entry.supportedParameters ?? [];
  return REASONING_PARAMETERS.some((parameter) =>
    supported.includes(parameter),
  );
}

/**
 * Cost of one average request, weighting output more heavily than input
 * because a chat completion emits far fewer tokens than it reads and a
 * ranking on input price alone puts long-context bargains above genuinely
 * cheap models.
 */
function blendedCostPerToken(entry: LLMModelEntry): number {
  const pricing = entry.pricing;
  if (!pricing) return Number.POSITIVE_INFINITY;
  const input = pricing.inputCostPerToken ?? 0;
  const output = pricing.outputCostPerToken ?? 0;
  if (input <= 0 && output <= 0) return Number.POSITIVE_INFINITY;
  return input * 0.75 + output * 0.25;
}

function providerAllowed({
  entry,
  boundProviderTypes,
}: {
  entry: LLMModelEntry;
  boundProviderTypes?: readonly string[];
}): boolean {
  if (!boundProviderTypes || boundProviderTypes.length === 0) return true;
  return boundProviderTypes.includes(entry.provider);
}

function toSuggestion(entry: LLMModelEntry): TierTargetSuggestion {
  return {
    modelId: entry.id,
    name: entry.name ?? entry.id,
    provider: entry.provider,
  };
}

/**
 * Concrete ids the latest-aliases currently resolve to, in the order the
 * aliases are listed, skipping any that resolve to nothing.
 */
function resolvedAliasIds(aliases: readonly string[]): string[] {
  const ids: string[] = [];
  for (const alias of aliases) {
    const resolved = resolveLatestAlias(alias);
    if (resolved && !ids.includes(resolved)) ids.push(resolved);
  }
  return ids;
}

/**
 * Suggests models for a tier, most appropriate first.
 *
 * Every tier leads with the models the latest-alias resolver already picks,
 * so what the product offers stays consistent with what the rest of the app
 * calls newest, and fills the rest of the list from the catalog by the
 * property the tier is about: capability for `complex`, declared reasoning
 * support for `reasoning`, price for `fast`.
 */
export function suggestTierTargets({
  tier,
  boundProviderTypes,
  limit = DEFAULT_LIMIT,
}: SuggestTierTargetsInput): TierTargetSuggestion[] {
  const catalog = Object.values(llmModels.models).filter(
    (entry) =>
      isChatModel(entry) && providerAllowed({ entry, boundProviderTypes }),
  );
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));

  const leadingIds = resolvedAliasIds(
    tier === "fast" ? FAST_ALIASES : FLAGSHIP_ALIASES,
  ).filter((id) => byId.has(id));

  const rest = tierOrderedRest({ tier, catalog, exclude: new Set(leadingIds) });

  const ordered = [...leadingIds.map((id) => byId.get(id)!), ...rest].map(
    toSuggestion,
  );

  if (ordered[0]) ordered[0].recommended = true;
  return ordered.slice(0, limit);
}

function tierOrderedRest({
  tier,
  catalog,
  exclude,
}: {
  tier: ModelTier;
  catalog: LLMModelEntry[];
  exclude: ReadonlySet<string>;
}): LLMModelEntry[] {
  const candidates = catalog.filter((entry) => !exclude.has(entry.id));
  if (tier === "reasoning") {
    // Most expensive first: within the models that reason, price tracks how
    // much thinking the model is built to do, and this tier is the one a
    // caller picks when they want that.
    return candidates
      .filter(supportsReasoning)
      .sort((a, b) => blendedCostPerToken(b) - blendedCostPerToken(a));
  }
  if (tier === "fast") {
    return candidates.sort(
      (a, b) => blendedCostPerToken(a) - blendedCostPerToken(b),
    );
  }
  // complex: the catalog carries no capability score, so price descending is
  // the available proxy, with context length breaking ties between models
  // priced the same.
  return candidates.sort(
    (a, b) =>
      blendedCostPerToken(b) - blendedCostPerToken(a) ||
      (b.contextLength ?? 0) - (a.contextLength ?? 0),
  );
}

/**
 * Reports whether a stored tier target still names a model the catalog knows,
 * so the product can flag a policy pointing at a retired model rather than
 * letting the first call discover it.
 */
export function isKnownModelId(modelId: string): boolean {
  return Boolean(llmModels.models[modelId]);
}

/**
 * Splits a policy's model name mapping into its tier entries and its ordinary
 * ones. Both sides are edited in different parts of the product, and this is
 * the one place that decides which is which.
 */
export function partitionTierAliases(modelAliases: Record<string, string>): {
  tiers: Partial<Record<ModelTier, string>>;
  names: Record<string, string>;
} {
  const tiers: Partial<Record<ModelTier, string>> = {};
  const names: Record<string, string> = {};
  for (const [from, to] of Object.entries(modelAliases)) {
    if (isModelTier(from)) {
      tiers[from] = to;
    } else {
      names[from] = to;
    }
  }
  return { tiers, names };
}
