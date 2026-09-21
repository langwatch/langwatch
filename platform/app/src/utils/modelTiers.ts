/**
 * Model id tier grammar and version ranking, shared by the server-side
 * latest-alias resolver (`server/modelProviders/latestAliases.ts`) and
 * every surface that pre-fills a "recommended" chat model, so the model a
 * picker shows is the model the org seed writes.
 *
 * Kept free of any catalog import: this module only knows how to read an
 * id, the catalog walk lives with the resolver.
 *
 * Each provider gets two allow-listed tiers, read from the id alone:
 *
 *   - "main": the newest general-purpose model of the line the provider
 *     positions for everyday serious work. Not the top tier (the premium
 *     priced one: GPT-6 Astra, GPT-5.6 Sol, Claude Fable, Gemini Pro) and
 *     not the small one.
 *   - "fast": the cost-efficient tier below it (GPT-5.6 Luna, Claude
 *     Sonnet, Gemini Flash Lite, DeepSeek Flash).
 *
 * Everything outside the two lists never ranks: the top tier, `-pro`
 * serving modes, nano and haiku, codex, chat, image, audio and vision
 * spin-offs, dated snapshots, experimental builds and `:batch` lanes.
 */

/** Newest-first sort key. `rank` breaks ties inside one generation. */
export interface ModelSortKey {
  major: number;
  minor: number;
  rank?: number;
}

/** Newest generation first, then highest tier rank. */
export function compareModelSortKeys(a: ModelSortKey, b: ModelSortKey): number {
  return (
    b.major - a.major || b.minor - a.minor || (b.rank ?? 0) - (a.rank ?? 0)
  );
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

/**
 * OpenAI: `gpt-<major>[.<minor>][-<tier>]`.
 *
 * Through GPT-5.5 a generation's general-purpose model was its unsuffixed
 * id (`gpt-5.5`) and the fast tier carried `-mini`. GPT-5.6 ships named
 * tiers and no unsuffixed id at all: Sol on top, Terra in the middle,
 * Luna as the fast tier. GPT-6 so far ships only Astra, priced as a top
 * tier, so it ranks nowhere and the main tier stays on GPT-5.6 Terra
 * until GPT-6 ships its middle tier. The number is a tiebreak used only
 * when one generation offers both spellings; the named tier wins.
 */
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
 * Anthropic: `claude-<tier>-<major>[-<minor>]`. Opus is the main tier,
 * Sonnet the fast one; Fable sits above Opus and Haiku below Sonnet, so
 * neither is an alias target. A generation without a minor (`claude-opus-5`)
 * is that generation's first release and outranks every `-4-x`.
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
 * Gemini: `gemini-<major>[.<minor>]-<tier>`. Flash is the main tier and
 * Flash Lite the fast one; Pro is the top tier. A preview ranks below the
 * release of the same generation. Image, audio and custom-tools variants
 * carry another tier word and never rank.
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
 * DeepSeek: `deepseek-v<major>[.<minor>][-<tier>]`. V4 names its tiers
 * Pro (main) and Flash (fast); V3 shipped one unsuffixed model per
 * release. Dated snapshots (`-pro-0813`), experimental builds (`-exp`),
 * vision variants and the older `deepseek-chat` / `deepseek-r1` ids do not
 * fit the grammar and never rank.
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
