/**
 * Client-safe heuristic for picking a sensible "default" model from a
 * provider's catalog. Mirrors the server-side `buildSeedPlanForProvider`
 * in `src/server/modelProviders/seedOnboardingDefaults.ts` so the
 * provider drawer's "Use as default" toggle pre-fills the same model
 * the onboarding seed would write at organization scope.
 *
 * Why two implementations: the server-side variant reads the full
 * `llmModels.json` registry (427KB, intentionally kept off the
 * client bundle). The client only has `modelSelectorOptions`, which
 * is already filtered to the provider's models in the drawer, so the
 * picker can run the same family-ranked sort over that array.
 *
 * If the heuristic doesn't match anything (unknown provider, or a
 * variant the provider doesn't ship), the caller can fall back to
 * the first model in its options list.
 */

export type Variant = "flagship" | "mini";

interface Candidate {
  id: string;
  major: number;
  minor: number;
}

function rankCandidates(candidates: Candidate[]): string | undefined {
  candidates.sort((a, b) =>
    b.major !== a.major ? b.major - a.major : b.minor - a.minor,
  );
  return candidates[0]?.id;
}

function pickOpenAI(
  modelIds: string[],
  variant: Variant,
): string | undefined {
  const candidates: Candidate[] = [];
  for (const id of modelIds) {
    const m = /^openai\/gpt-(\d+)\.(\d+)(-[a-z0-9-]+)?$/.exec(id);
    if (!m) continue;
    const [, major, minor, suffix] = m;
    const suffixWord = suffix?.slice(1) ?? "";
    if (variant === "flagship" && suffixWord) continue;
    if (variant === "mini" && suffixWord !== "mini") continue;
    candidates.push({ id, major: Number(major), minor: Number(minor) });
  }
  return rankCandidates(candidates);
}

function pickAnthropic(
  modelIds: string[],
  variant: Variant,
): string | undefined {
  // Anthropic intentionally maps both flagship and mini to the latest
  // sonnet. Haiku trails sonnet by a wide enough margin on the assistive
  // tasks (search, autocomplete, topic clustering) that even the FAST
  // role is better served by sonnet. Mirrors the server-side seed plan.
  const candidates: Candidate[] = [];
  for (const id of modelIds) {
    const m = /^anthropic\/claude-sonnet-(\d+)-(\d+)$/.exec(id);
    if (!m) continue;
    candidates.push({ id, major: Number(m[1]), minor: Number(m[2]) });
  }
  void variant;
  return rankCandidates(candidates);
}

function pickGemini(
  modelIds: string[],
  variant: Variant,
): string | undefined {
  const family = variant === "flagship" ? "pro" : "flash";
  const candidates: Candidate[] = [];
  // Allow-list rather than prefix-match: the catalog ships variants
  // like `pro-preview-customtools` and `flash-image-preview` whose
  // names match a permissive `^pro(-|$)` / `^flash(-|$)` regex but
  // aren't the general-purpose chat model the picker promises.
  const proSuffixes = new Set(["pro", "pro-preview"]);
  const flashSuffixes = new Set([
    "flash",
    "flash-lite",
    "flash-preview",
    "flash-lite-preview",
  ]);
  const allowed = family === "pro" ? proSuffixes : flashSuffixes;
  for (const id of modelIds) {
    const m = /^gemini\/gemini-(\d+)\.(\d+)-([a-z-]+)$/.exec(id);
    if (!m) continue;
    const [, major, minor, suffix] = m;
    if (!allowed.has(suffix!)) continue;
    candidates.push({ id, major: Number(major), minor: Number(minor) });
  }
  return rankCandidates(candidates);
}

/**
 * Pick the model id of the requested family/variant from a list of
 * `provider/model` strings. Returns `undefined` if no candidate
 * matches; the caller can then fall back to the first option.
 */
export function pickFlagshipFromOptions(
  providerKey: string,
  variant: Variant,
  modelIds: string[],
): string | undefined {
  if (providerKey === "openai") return pickOpenAI(modelIds, variant);
  if (providerKey === "anthropic") return pickAnthropic(modelIds, variant);
  if (providerKey === "gemini") return pickGemini(modelIds, variant);
  return undefined;
}

/**
 * Pick the newest embedding model for a provider from a list of
 * `provider/model` strings. The id format varies by provider, so we
 * sort by the first numeric chunk found in the model portion of the
 * id (e.g. `text-embedding-3-small` → 3, `gemini-embedding-2-preview`
 * → 2). Same heuristic as the server-side `pickLatestEmbedding`.
 */
export function pickLatestEmbeddingFromOptions(
  providerKey: string,
  modelIds: string[],
): string | undefined {
  const matches = modelIds.filter((id) =>
    id.startsWith(`${providerKey}/`),
  );
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => {
    const aN = Number(/\d+/.exec(a.split("/")[1] ?? "")?.[0] ?? 0);
    const bN = Number(/\d+/.exec(b.split("/")[1] ?? "")?.[0] ?? 0);
    return bN - aN;
  });
  return matches[0];
}
