/**
 * Virtual "latest" / "latest-mini" model aliases.
 *
 * A config can store `openai/latest` or `anthropic/latest-mini` instead
 * of pinning a concrete model id. At read time the alias resolves to the
 * current registry flagship for that provider's variant, so default
 * picks track upstream releases without users having to manually rotate.
 *
 * Aliases live in code, NOT in `llmModels.json` / `llmModels.overlay.json`.
 * They are a UI + resolver concept; downstream consumers (litellm /
 * langwatch_nlp / aigateway) only ever see the resolved concrete id.
 *
 * Only providers we know how to "latest"-pick are aliased — openai,
 * anthropic, gemini. Azure/Bedrock customers pin specific deployment
 * names and skipping them was a deliberate ask from rchaves.
 */
import {
  pickLatestAnthropicChat,
  pickLatestGeminiChat,
  pickLatestOpenAIChat,
} from "./seedOnboardingDefaults";

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

/**
 * Resolves an alias like `openai/latest-mini` to its concrete current
 * flagship, e.g. `openai/gpt-5.5-mini`. Returns `null` if the input is
 * not an alias OR if the registry has nothing matching the variant.
 *
 * Variants per provider:
 *   - openai     → `gpt-X.Y` (latest), `gpt-X.Y-mini` (latest-mini)
 *   - anthropic  → `claude-sonnet-X-Y` (latest), `claude-haiku-X-Y` (latest-mini)
 *   - gemini     → `gemini-X.Y-pro` (latest), `gemini-X.Y-flash` (latest-mini)
 */
export function resolveLatestAlias(model: string): string | null {
  const parts = parseLatestAlias(model);
  if (!parts) return null;
  const { provider, suffix } = parts;
  if (provider === "openai") {
    return pickLatestOpenAIChat(suffix === "latest" ? "plain" : "mini") ?? null;
  }
  if (provider === "anthropic") {
    return pickLatestAnthropicChat(suffix === "latest" ? "sonnet" : "haiku") ?? null;
  }
  if (provider === "gemini") {
    return pickLatestGeminiChat(suffix === "latest" ? "pro" : "flash") ?? null;
  }
  return null;
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
  /** The concrete model id the alias currently resolves to, e.g. `openai/gpt-5.5`. */
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
