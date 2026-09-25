/**
 * Model id tier grammar and version ranking, shared by the server-side
 * latest-alias resolver (`server/modelProviders/latestAliases.ts`) and
 * every surface that pre-fills a "recommended" chat model, so the model a
 * picker shows is the model the org seed writes.
 *
 * Kept free of any catalog import: this module only knows how to read
 * ids, the catalog walk lives with the resolver.
 *
 * Each provider gets two allow-listed tiers, read from the ids:
 *
 *   - "main": the newest general-purpose model of the line the provider
 *     positions for everyday serious work. Not the top tier (the premium
 *     priced one: GPT-6 Astra, GPT-5.6 Sol, Claude Fable, Gemini Pro) and
 *     not the small one.
 *   - "fast": the cost-efficient tier below it (GPT-6 Luna, Claude
 *     Sonnet, Gemini Flash Lite, DeepSeek Flash).
 *
 * Most tier words keep their meaning across generations and are read from
 * the id alone. OpenAI's named tiers do not (Sol is GPT-5.6's top tier but
 * GPT-6's middle one), so those are read against what else the same
 * generation ships; see `ProviderTierGrammar.ladder`.
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
  /**
   * Named tiers whose role depends on the generation's lineup, top first.
   * In each generation the highest rung it ships is its top tier and never
   * ranks; the next rung it ships is its main tier, ranked above every
   * word in `main`. A generation shipping a single rung has no main tier
   * yet. Words missing from the ladder never rank, so a new top-tier name
   * only needs adding here to be skipped correctly.
   */
  ladder?: readonly string[];
}

/** Rank of a ladder-derived main tier: above every fixed `main` word. */
const LADDER_MAIN_RANK = 100;

const version = (major: string, minor: string | undefined): ParsedModelId => ({
  major: Number(major),
  minor: minor === undefined ? 0 : Number(minor),
  tier: "",
});

/**
 * OpenAI: `gpt-<major>[.<minor>][-<tier>]`.
 *
 * Through GPT-5.5 a generation's general-purpose model was its unsuffixed
 * id (`gpt-5.5`) and the fast tier carried `-mini`. From GPT-5.6 on the
 * tiers are named and there is no unsuffixed id: Luna is always the fast
 * tier, and the names above it shift per generation. GPT-5.6 ships Sol on
 * top and Terra in the middle; GPT-6 ships Astra on top and Sol in the
 * middle. So the main tier is the second rung of the ladder that
 * generation actually ships. While a generation ships only its top tier
 * (GPT-6 before Sol launched), it has no main tier and the alias stays on
 * the previous generation. The numbers are a tiebreak used only when one
 * generation offers both spellings; the named tier wins.
 */
const OPENAI: ProviderTierGrammar = {
  parse: (id) => {
    const m = /^openai\/gpt-(\d+)(?:\.(\d+))?(?:-([a-z0-9-]+))?$/.exec(id);
    if (!m) return null;
    return { ...version(m[1]!, m[2]), tier: m[3] ?? "" };
  },
  main: { "": 0 },
  fast: { mini: 0, luna: 1 },
  ladder: ["astra", "sol", "terra"],
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

/** A ranked candidate: the id plus its newest-first sort key. */
export type RankedModel = ModelSortKey & { id: string };

type ParsedCandidate = ParsedModelId & { id: string };

const generationOf = (p: ParsedModelId) => `${p.major}.${p.minor}`;

/**
 * The ladder tier each generation ships as its main tier: the second
 * rung it ships, counted from the top. Generations shipping fewer than two
 * rungs have no entry.
 */
function ladderMainTiers(
  parsed: ParsedCandidate[],
  ladder: readonly string[],
): Map<string, string> {
  const rungsByGeneration = new Map<string, number[]>();
  for (const p of parsed) {
    const rung = ladder.indexOf(p.tier);
    if (rung < 0) continue;
    const key = generationOf(p);
    rungsByGeneration.set(key, [...(rungsByGeneration.get(key) ?? []), rung]);
  }
  const mainTiers = new Map<string, string>();
  for (const [key, rungs] of rungsByGeneration) {
    const second = [...new Set(rungs)].sort((a, b) => a - b)[1];
    if (second !== undefined) mainTiers.set(key, ladder[second]!);
  }
  return mainTiers;
}

/**
 * Ranks a provider's chat model ids for the requested variant, newest
 * first. Ids that are not members of that variant's tier, and every id of
 * a provider without a grammar, are left out. Pass the provider's whole
 * chat lineup: ladder tiers are read against their generation's siblings.
 */
export function rankChatModels({
  ids,
  provider,
  variant,
}: {
  ids: Iterable<string>;
  provider: string;
  variant: ModelVariant;
}): RankedModel[] {
  const grammar = GRAMMARS[provider];
  if (!grammar) return [];

  const parsed: ParsedCandidate[] = [];
  for (const id of ids) {
    const p = grammar.parse(id);
    if (p) parsed.push({ id, ...p });
  }

  const ladder = grammar.ladder ?? [];
  const mainTiers = ladderMainTiers(parsed, ladder);
  const rankOf = (p: ParsedCandidate): number | undefined => {
    if (!ladder.includes(p.tier)) return grammar[variant][p.tier];
    const isMain =
      variant === "main" && mainTiers.get(generationOf(p)) === p.tier;
    return isMain ? LADDER_MAIN_RANK : undefined;
  };

  const ranked: RankedModel[] = [];
  for (const p of parsed) {
    const rank = rankOf(p);
    if (rank !== undefined) {
      ranked.push({ id: p.id, major: p.major, minor: p.minor, rank });
    }
  }
  return ranked.sort(compareModelSortKeys);
}
