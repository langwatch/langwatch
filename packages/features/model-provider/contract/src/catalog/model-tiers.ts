/**
 * Model id tier grammar and version ranking, shared by the server-side
 * latest-alias resolver (`catalog/latest-aliases.ts`) and
 * the client-side provider-drawer picker (`utils/pickFlagshipModel.ts`)
 * so the model the drawer pre-fills is the model the org seed writes.
 *
 * Kept free of any catalog import: the client bundle must not pull in
 * `llmModels.json`.
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
 * OpenAI's flagship tiers, newest naming last.
 *
 * Through GPT-5.5 a generation's flagship was its unsuffixed id
 * (`gpt-5.5`). GPT-5.6 replaced that with named tiers and ships no
 * unsuffixed id at all, so matching on "no suffix" alone finds nothing
 * in the newer generation and the alias silently keeps serving GPT-5.5.
 *
 * The number is a tiebreak used only when one generation offers both
 * spellings; the named tier wins.
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
 * Ranks an OpenAI chat model id for the requested variant, or returns
 * null when the id is not a member of that variant's tier.
 *
 * Both tier maps are allow-lists, which is what keeps everything that
 * is not a general-purpose chat tier out of role defaults: `-pro`
 * serving modes (the same model at higher reasoning effort, priced for
 * hard one-off problems rather than every assistive call), `nano`,
 * `codex`, `chat` and the image spin-offs. `terra` is deliberately
 * absent too: a balanced middle tier answers neither "most capable"
 * nor "fastest", so it stays explicitly selectable without ever being
 * picked automatically.
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
