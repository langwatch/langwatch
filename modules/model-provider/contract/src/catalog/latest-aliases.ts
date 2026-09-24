/**
 * Virtual "latest" / "latest-mini" aliases: resolve to the newest main/fast
 * tier model at read time (grammar in `./model-tiers.ts`). Code-only, and
 * only openai/anthropic/gemini are aliased.
 */
import { llmModels } from "./model-catalog.ts";
import {
  compareModelSortKeys,
  type ModelSortKey,
  type ModelVariant,
  deriveChatModelRank,
} from "./model-tiers.ts";

const REGISTRY = llmModels.models;

export const LATEST_ALIAS_SUFFIXES = ["latest", "latest-mini"] as const;
export type LatestAliasSuffix = (typeof LATEST_ALIAS_SUFFIXES)[number];

export const LATEST_ALIAS_PROVIDERS = ["openai", "anthropic", "gemini"] as const;
export type LatestAliasProvider = (typeof LATEST_ALIAS_PROVIDERS)[number];

const ALIAS_PATTERN = new RegExp(
  `^(${LATEST_ALIAS_PROVIDERS.join("|")})\\/(${LATEST_ALIAS_SUFFIXES.join("|")})$`,
);

export interface LatestAliasParts {
  provider: LatestAliasProvider;
  suffix: LatestAliasSuffix;
}

/** Returns the parsed parts for a `<provider>/<suffix>` alias, or null. */
export function parseLatestAlias(model: string): LatestAliasParts | null {
  const match = ALIAS_PATTERN.exec(model);
  if (!match) return null;
  return {
    provider: match[1] as LatestAliasProvider,
    suffix: match[2] as LatestAliasSuffix,
  };
}

export function isLatestAlias(model: string): boolean {
  return ALIAS_PATTERN.test(model);
}

/** The newest catalog chat model of a provider's tier, or null if none ranks. */
export function pickChatModel(provider: string, variant: ModelVariant): string | null {
  const candidates: (ModelSortKey & { id: string })[] = [];
  for (const model of Object.values(REGISTRY)) {
    if (model.provider !== provider || model.mode !== "chat") continue;
    const parsed = deriveChatModelRank({ id: model.id, provider, variant });
    if (parsed) candidates.push({ id: model.id, ...parsed });
  }
  candidates.sort(compareModelSortKeys);
  return candidates[0]?.id ?? null;
}

/**
 * The chat model a provider card recommends: the newest main-tier model in
 * the catalog, the same pick `<provider>/latest` resolves to where that
 * alias exists. Provider-qualified, e.g. `openai/gpt-5.6-terra`.
 */
export function pickRecommendedChatModel(provider: string): string | null {
  return pickChatModel(provider, "main");
}

/**
 * Resolves an alias to its concrete current pick, e.g. `openai/gpt-5.6-luna`.
 * Null if the input is not an alias or nothing matches the variant.
 */
export function resolveLatestAlias(model: string): string | null {
  const parts = parseLatestAlias(model);
  if (!parts) return null;
  return pickChatModel(parts.provider, parts.suffix === "latest" ? "main" : "fast");
}

/**
 * If the input is a latest-alias, returns the resolved concrete model id;
 * otherwise returns it unchanged. Use this at every read-time boundary
 * handing a model id to a downstream service that doesn't understand aliases.
 */
export function expandLatestAlias(model: string): string {
  const resolved = resolveLatestAlias(model);
  return resolved ?? model;
}

export interface LatestAliasEntry {
  /** The alias id stored in config and shown as the value, e.g. `openai/latest`. */
  alias: string;
  /** The concrete model id the alias currently resolves to, e.g. `openai/gpt-5.6-terra`. */
  resolved: string | null;
  provider: LatestAliasProvider;
  suffix: LatestAliasSuffix;
}

/**
 * Enumerates every supported alias paired with its current resolution.
 * Used by the model picker to render the two virtual entries per provider
 * with a subtitle showing the concrete model.
 */
export function allLatestAliases(): LatestAliasEntry[] {
  const out: LatestAliasEntry[] = [];
  for (const provider of LATEST_ALIAS_PROVIDERS) {
    for (const suffix of LATEST_ALIAS_SUFFIXES) {
      const alias = `${provider}/${suffix}`;
      out.push({
        alias,
        resolved: resolveLatestAlias(alias),
        provider,
        suffix,
      });
    }
  }
  return out;
}
