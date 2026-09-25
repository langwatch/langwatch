/**
 * Virtual "latest" / "latest-mini" model aliases.
 *
 * A config can store `openai/latest` or `anthropic/latest-mini` instead
 * of pinning a concrete model id. At read time the alias resolves to the
 * newest model of that provider's main or fast tier in the catalog, so
 * default picks track upstream releases without users having to manually
 * rotate. The tier grammar lives in `utils/modelTiers`.
 *
 * Aliases live in code, NOT in `llmModels.json` / `llmModels.overlay.json`.
 * They are a UI + resolver concept; downstream consumers (litellm /
 * langwatch_nlp / aigateway) only ever see the resolved concrete id.
 *
 * Only providers we know how to "latest"-pick are aliased: openai,
 * anthropic, gemini. Azure/Bedrock customers pin specific deployment
 * names, so they are intentionally excluded.
 */
import { type ModelVariant, rankChatModels } from "../../utils/modelTiers";
import { llmModels } from "./loadModelCatalog";

interface RegistryEntry {
  id: string;
  provider: string;
  mode: "chat" | "embedding";
}

const REGISTRY = (
  llmModels as unknown as { models: Record<string, RegistryEntry> }
).models;

export const LATEST_ALIAS_SUFFIXES = ["latest", "latest-mini"] as const;
export type LatestAliasSuffix = (typeof LATEST_ALIAS_SUFFIXES)[number];

export const LATEST_ALIAS_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
] as const;
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

/**
 * The newest chat model of one tier of a provider, read from the catalog
 * through the provider's tier grammar: `main` for the general-purpose
 * model, `fast` for the cost-efficient one. Null when the provider has no
 * grammar or the catalog carries nothing in that tier.
 */
export function pickChatModel(
  provider: string,
  variant: ModelVariant,
): string | null {
  const ids = Object.values(REGISTRY)
    .filter((model) => model.provider === provider && model.mode === "chat")
    .map((model) => model.id);
  return rankChatModels({ ids, provider, variant })[0]?.id ?? null;
}

/**
 * The chat model a provider card recommends: the newest main-tier model in
 * the catalog, the same pick `<provider>/latest` resolves to where that
 * alias exists. Provider-qualified, e.g. `openai/gpt-6-sol`.
 */
export function recommendedChatModel(provider: string): string | null {
  return pickChatModel(provider, "main");
}

/**
 * Resolves an alias like `openai/latest-mini` to its concrete current
 * pick, e.g. `openai/gpt-6-luna`. Returns `null` if the input is
 * not an alias OR if the registry has nothing matching the variant.
 *
 * `latest` is the provider's main tier, `latest-mini` its fast tier; see
 * `utils/modelTiers` for what each provider's tiers are and what never
 * ranks (the top tier, pro serving modes, nano and haiku, spin-offs).
 */
export function resolveLatestAlias(model: string): string | null {
  const parts = parseLatestAlias(model);
  if (!parts) return null;
  return pickChatModel(
    parts.provider,
    parts.suffix === "latest" ? "main" : "fast",
  );
}

/**
 * If the input is a latest-alias, returns the resolved concrete model id.
 * Otherwise returns the input unchanged. Use this at every read-time
 * boundary that hands a model id to a downstream service that doesn't
 * understand aliases.
 */
export function expandLatestAlias(model: string): string {
  const resolved = resolveLatestAlias(model);
  return resolved ?? model;
}

export interface LatestAliasEntry {
  /** The alias id stored in config and shown as the value, e.g. `openai/latest`. */
  alias: string;
  /** The concrete model id the alias currently resolves to, e.g. `openai/gpt-6-sol`. */
  resolved: string | null;
  provider: LatestAliasProvider;
  suffix: LatestAliasSuffix;
}

/**
 * Enumerates every supported alias paired with its current resolution.
 * Used by the model picker to render the two virtual entries per
 * provider with a subtitle showing the concrete model.
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
