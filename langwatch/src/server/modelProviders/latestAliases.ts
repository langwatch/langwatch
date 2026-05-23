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
 * names, so they are intentionally excluded.
 */
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
 * Generic "newest chat model for this provider" picker. Callers supply
 * a parse function that decides whether a model id is in-scope and
 * extracts its (major, minor) sort key. The catalog walk, mode/provider
 * filter, and version sort are shared because all providers follow the
 * same shape — only the id grammar differs.
 */
function pickLatestChat(
  provider: string,
  parse: (id: string) => { major: number; minor: number } | null,
): string | undefined {
  const candidates: { id: string; major: number; minor: number }[] = [];
  for (const model of Object.values(REGISTRY)) {
    if (model.provider !== provider || model.mode !== "chat") continue;
    const parsed = parse(model.id);
    if (parsed) candidates.push({ id: model.id, ...parsed });
  }
  candidates.sort((a, b) =>
    b.major !== a.major ? b.major - a.major : b.minor - a.minor,
  );
  return candidates[0]?.id;
}

/**
 * Resolves an alias like `openai/latest-mini` to its concrete current
 * flagship, e.g. `openai/gpt-5.5-mini`. Returns `null` if the input is
 * not an alias OR if the registry has nothing matching the variant.
 *
 * Variants per provider:
 *   - openai     → `gpt-X.Y` (latest), `gpt-X.Y-mini` (latest-mini)
 *   - anthropic  → `claude-opus-X-Y` (latest), `claude-sonnet-X-Y` (latest-mini)
 *   - gemini     → `gemini-X.Y-pro` (latest), `gemini-X.Y-flash` (latest-mini)
 *
 * Anthropic's `haiku` and OpenAI's `nano` tiers are intentionally
 * excluded — they're a tier below "fast" and not what users expect
 * when they pick "latest-mini" as their FAST default.
 *
 * Gemini's "pro" / "flash" families admit a curated set of suffixes
 * (e.g. `pro-preview`, `flash-lite`) so noisy spin-offs like
 * `flash-image-preview` don't sneak in as defaults.
 */
export function resolveLatestAlias(model: string): string | null {
  const parts = parseLatestAlias(model);
  if (!parts) return null;
  const { provider, suffix } = parts;
  if (provider === "openai") {
    return (
      pickLatestChat("openai", (id) => {
        const m = /^openai\/gpt-(\d+)\.(\d+)(-[a-z0-9-]+)?$/.exec(id);
        if (!m) return null;
        const variant = m[3]?.slice(1) ?? "";
        if (suffix === "latest" && variant) return null;
        if (suffix === "latest-mini" && variant !== "mini") return null;
        return { major: Number(m[1]), minor: Number(m[2]) };
      }) ?? null
    );
  }
  if (provider === "anthropic") {
    const family = suffix === "latest" ? "opus" : "sonnet";
    return (
      pickLatestChat("anthropic", (id) => {
        const m = new RegExp(`^anthropic\\/claude-${family}-(\\d+)-(\\d+)$`).exec(id);
        if (!m) return null;
        return { major: Number(m[1]), minor: Number(m[2]) };
      }) ?? null
    );
  }
  if (provider === "gemini") {
    const allowed =
      suffix === "latest"
        ? new Set(["pro", "pro-preview"])
        : new Set(["flash", "flash-lite", "flash-preview", "flash-lite-preview"]);
    return (
      pickLatestChat("gemini", (id) => {
        const m = /^gemini\/gemini-(\d+)\.(\d+)-([a-z-]+)$/.exec(id);
        if (!m) return null;
        if (!allowed.has(m[3]!)) return null;
        return { major: Number(m[1]), minor: Number(m[2]) };
      }) ?? null
    );
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
