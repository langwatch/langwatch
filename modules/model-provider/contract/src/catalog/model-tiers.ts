/**
 * Model id tier grammar: two allow-listed tiers read from the id alone,
 * "main" (general-purpose, never the premium top tier) and "fast". Shared
 * by the latest-alias resolver and every "recommended model" surface.
 */

/** Newest-first sort key. `rank` breaks ties inside one generation. */
export interface ModelSortKey {
  major: number;
  minor: number;
  rank?: number;
}

/** Newest generation first, then highest tier rank. */
export function compareModelSortKeys(a: ModelSortKey, b: ModelSortKey): number {
  return b.major - a.major || b.minor - a.minor || (b.rank ?? 0) - (a.rank ?? 0);
}

export type ModelVariant = "main" | "fast";

/** The generation and tier read from one model id. */
interface ParsedModelId {
  major: number;
  minor: number;
  tier: string;
}

/**
 * One provider's id grammar. `parse` reads the generation and the tier
 * word; the two maps say which tier words belong to which variant and
 * how they rank against each other inside one generation (higher wins).
 */
interface ProviderTierGrammar {
  parse: (id: string) => ParsedModelId | null;
  main: Record<string, number>;
  fast: Record<string, number>;
}

const version = (major: string, minor: string | undefined): ParsedModelId => ({
  major: Number(major),
  minor: minor === undefined ? 0 : Number(minor),
  tier: "",
});

/** OpenAI: `gpt-<major>[.<minor>][-<tier>]`. GPT-5.6 names tiers: Sol, Terra main, Luna fast. */
const OPENAI: ProviderTierGrammar = {
  parse: (id) => {
    const m = /^openai\/gpt-(\d+)(?:\.(\d+))?(?:-([a-z0-9-]+))?$/.exec(id);
    if (!m) return null;
    return { ...version(m[1]!, m[2]), tier: m[3] ?? "" };
  },
  main: { "": 0, terra: 1 },
  fast: { mini: 0, luna: 1 },
};

/**
 * Anthropic: `claude-<tier>-<major>[-<minor>]`. Opus is main, Sonnet is
 * fast; Fable and Haiku never rank. No minor (`claude-opus-5`) means the
 * generation's first release, outranking every `-4-x`.
 */
const ANTHROPIC: ProviderTierGrammar = {
  parse: (id) => {
    const m = /^anthropic\/claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
    if (!m) return null;
    return { ...version(m[2]!, m[3]), tier: m[1]! };
  },
  main: { opus: 0 },
  fast: { sonnet: 0 },
};

/**
 * Gemini: `gemini-<major>[.<minor>]-<tier>`. Flash is main, Flash Lite is
 * fast, Pro never ranks. A preview ranks below its generation's release.
 */
const GEMINI: ProviderTierGrammar = {
  parse: (id) => {
    const m = /^gemini\/gemini-(\d+)(?:\.(\d+))?-([a-z-]+)$/.exec(id);
    if (!m) return null;
    return { ...version(m[1]!, m[2]), tier: m[3]! };
  },
  main: { "flash-preview": 0, flash: 1 },
  fast: { "flash-lite-preview": 0, "flash-lite": 1 },
};

/**
 * DeepSeek: `deepseek-v<major>[.<minor>][-<tier>]`. V4 names Pro (main) and
 * Flash (fast); V3 shipped one unsuffixed model. Dated, experimental and
 * vision variants never rank.
 */
const DEEPSEEK: ProviderTierGrammar = {
  parse: (id) => {
    const m = /^deepseek\/deepseek-v(\d+)(?:\.(\d+))?(?:-([a-z]+))?$/.exec(id);
    if (!m) return null;
    return { ...version(m[1]!, m[2]), tier: m[3] ?? "" };
  },
  main: { "": 0, pro: 1 },
  fast: { flash: 0 },
};

const GRAMMARS: Record<string, ProviderTierGrammar> = {
  openai: OPENAI,
  anthropic: ANTHROPIC,
  gemini: GEMINI,
  deepseek: DEEPSEEK,
};

/** The providers whose ids the ranking knows how to read. */
export const TIERED_PROVIDERS = Object.keys(GRAMMARS);

/**
 * Ranks a chat model id for the requested variant of its provider, or
 * returns null when the id is not a member of that variant's tier, or the
 * provider has no grammar.
 */
export function rankChatModel({
  id,
  provider,
  variant,
}: {
  id: string;
  provider: string;
  variant: ModelVariant;
}): ModelSortKey | null {
  const grammar = GRAMMARS[provider];
  if (!grammar) return null;
  const parsed = grammar.parse(id);
  if (!parsed) return null;
  const rank = grammar[variant][parsed.tier];
  if (rank === undefined) return null;
  return { major: parsed.major, minor: parsed.minor, rank };
}
