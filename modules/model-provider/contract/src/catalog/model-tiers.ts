/**
 * Shared by the server latest-alias resolver and the client provider-drawer
 * picker; kept free of any catalog import so the client bundle never pulls in `llmModels.json`.
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

export type OpenAIVariant = "flagship" | "mini";

/**
 * OpenAI's flagship tiers, newest naming last. GPT-5.6 replaced the unsuffixed-id
 * convention with named tiers, so matching on "no suffix" alone would miss it.
 */
export const OPENAI_FLAGSHIP_TIERS: Record<string, number> = {
  "": 0,
  sol: 1,
};

/**
 * OpenAI's fast tiers, the counterpart for `latest-mini`. GPT-5.6 calls
 * this tier Luna; earlier generations called it `-mini`.
 */
export const OPENAI_FAST_TIERS: Record<string, number> = {
  mini: 0,
  luna: 1,
};

const OPENAI_CHAT_ID = /^openai\/gpt-(\d+)\.(\d+)(-[a-z0-9-]+)?$/;

/**
 * Ranks an OpenAI chat model id for the requested variant, or null if it isn't a
 * member of that tier. Both tier maps are allow-lists, keeping `-pro`, `nano`,
 * `codex`, `chat`, image spin-offs and `terra` out of automatic role defaults.
 */
export function rankOpenAIChatModel({
  id,
  variant,
}: {
  id: string;
  variant: OpenAIVariant;
}): ModelSortKey | null {
  const match = OPENAI_CHAT_ID.exec(id);
  if (!match) return null;
  const tier = match[3]?.slice(1) ?? "";
  const tiers = variant === "flagship" ? OPENAI_FLAGSHIP_TIERS : OPENAI_FAST_TIERS;
  const rank = tiers[tier];
  if (rank === undefined) return null;
  return { major: Number(match[1]), minor: Number(match[2]), rank };
}
