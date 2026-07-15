import type { CustomModelEntry } from "./customModel.schema";
import type { MaybeStoredModelProvider } from "./registry";

/** Narrowest scope first. A row with no scope at all ranks last. */
const SCOPE_RANK = { PROJECT: 0, TEAM: 1, ORGANIZATION: 2 } as const;
const UNSCOPED_RANK = 3;

/**
 * Ranks a row by its narrowest scope, read from the `scopes[]` grant set
 * that `registry.ts` directs consumers to prefer over the collapsed
 * pair. Falls back to the collapsed `scopeType` for callers that set only
 * that, and ranks a row carrying neither as unscoped.
 */
const scopeRank = (row: MaybeStoredModelProvider): number => {
  const scopeTypes = row.scopes?.length
    ? row.scopes.map((scope) => scope.scopeType)
    : [row.scopeType];

  return Math.min(
    ...scopeTypes.map((scopeType) =>
      scopeType ? SCOPE_RANK[scopeType] : UNSCOPED_RANK,
    ),
  );
};

/**
 * How good a row is as a source of display names, as tiers compared in
 * order with the LOWEST value winning each:
 * enabled ▸ narrowest scope ▸ persisted ▸ lowest id.
 *
 * The first two tiers are the collapse rule
 * `ModelProviderService.isNarrower` already applies to these same rows;
 * the last two extend it to a total order over distinct *persisted*
 * rows. They cannot separate two rows that both lack an `id`, which rank
 * alike on both (`1`, then `""`), so such a pair tied on the first two
 * tiers as well falls through to arrival order. No caller opens that
 * gap: `buildDefaultProviders` synthesizes at most one row per provider
 * and never gives it custom models.
 *
 * The persisted tier is not redundant with the id tier under it: `""`
 * sorts below every real id, so without it an id-less row would beat
 * every stored one rather than lose to it.
 *
 * The id tier is a determinism device, not a meaningful one — it settles
 * a tie reproducibly, and a lower id says nothing about a row being the
 * more correct source of a name.
 */
const precedence = (row: MaybeStoredModelProvider) =>
  [row.enabled ? 0 : 1, scopeRank(row), row.id ? 0 : 1, row.id ?? ""] as const;

/** Orders rows best-first: lexicographic over `precedence`, lower wins. */
const byPrecedence = (
  left: MaybeStoredModelProvider,
  right: MaybeStoredModelProvider,
): number => {
  const rightTiers = precedence(right);

  for (const [tier, ours] of precedence(left).entries()) {
    const theirs = rightTiers[tier]!;
    if (ours !== theirs) return ours < theirs ? -1 : 1;
  }

  return 0;
};

const customEntriesOf = (
  value: CustomModelEntry[] | null | undefined,
): CustomModelEntry[] => (Array.isArray(value) ? value : []);

/**
 * The Display Name a user chose for this entry, or null when the entry
 * carries none. An entry names nothing when its `modelId` is not a
 * non-empty string, when its `displayName` is not a string or is blank,
 * or when the name merely repeats the `modelId`.
 *
 * That last case is what `toLegacyCompatibleCustomModels` synthesizes for
 * a legacy `string[]` row: an artifact of the conversion rather than a
 * name anyone chose. Dropping it costs the entry's own label nothing,
 * since `modelDisplayLabel` falls back to exactly that model id anyway.
 * Where it does decide something — deliberately — is when another row
 * names the same model: the artifact never competes, so the real name
 * wins the key even from a row the artifact's row would outrank.
 */
const configuredDisplayName = (entry: CustomModelEntry): string | null => {
  const modelId = entry?.modelId;
  if (typeof modelId !== "string" || !modelId) return null;
  if (typeof entry.displayName !== "string") return null;

  const displayName = entry.displayName.trim();
  if (!displayName || displayName === modelId) return null;

  return displayName;
};

/**
 * Builds a lookup of configured Display Name for every custom model on
 * the given provider rows, chat and embeddings alike, so one map serves
 * every role a picker renders.
 *
 * Each name is keyed under both `<provider>/<modelId>` and, for a
 * persisted row, `<rowId>/<modelId>`: callers hold a full model id in
 * either form, and a map keyed only one way silently misses the other.
 *
 * Takes rows rather than a `Record` keyed by provider: a provider can
 * be stored at several scopes, and collapsing those rows by key first
 * would drop one row's custom models on the floor.
 *
 * When several rows configure a name for the same key, the best-ranked
 * row wins: rows are visited best-first (see `precedence`) and the first
 * write of a key sticks. That makes the result independent of the order
 * rows arrive in for every pair of rows the ranking separates, which is
 * every pair of distinct persisted rows — worth having because
 * `findAllAccessibleForProject` issues a bare `findMany` with no
 * `orderBy`, so row order carries no meaning to read precedence from.
 * Two rows that both lack an `id` are the pair it cannot separate;
 * `precedence` covers why no caller produces them.
 *
 * Precedence lands per key rather than per model, because the two key
 * spaces collide differently: two rows can share a `<provider>/<modelId>`
 * key, but never a `<rowId>/<modelId>` one. So a row that loses the
 * shared key still writes the row-id-keyed name no other row can claim.
 *
 * Only entries that name something compete, so a row's malformed or
 * unnamed entry costs no other row its name. The lists are JSON behind
 * an unchecked cast (`toLegacyCompatibleCustomModels` returns one), so
 * a hand-edited or migrated row can reach here holding any shape,
 * including a list that is not a list.
 *
 * Not to be confused with `mergeCustomModelMetadata`
 * (src/server/api/routers/modelProviders.utils.ts), which also reads
 * `displayName` off these same lists. Its record is keyed by model-
 * provider id, not provider type, so the two key spaces don't join —
 * it answers "what can this model do", this answers "what do we call
 * it".
 */
export const buildCustomModelDisplayNames = (
  modelProviders: readonly MaybeStoredModelProvider[],
): Record<string, string> => {
  const displayNames: Record<string, string> = {};

  for (const row of [...modelProviders].sort(byPrecedence)) {
    const entries = [
      ...customEntriesOf(row.customModels),
      ...customEntriesOf(row.customEmbeddingsModels),
    ];

    for (const entry of entries) {
      const displayName = configuredDisplayName(entry);
      if (!displayName) continue;

      const keys = [`${row.provider}/${entry.modelId}`];
      if (row.id) keys.push(`${row.id}/${entry.modelId}`);

      for (const key of keys) displayNames[key] ??= displayName;
    }
  }

  return displayNames;
};

/**
 * Resolves the label to render for a full model id
 * (`<provider>/<modelId>` or `<rowId>/<modelId>`): the configured custom
 * display name when one exists, otherwise the id's family part — the
 * same fallback every selector used before display names existed, and
 * the label a legacy custom model resolves to.
 *
 * `||`, not `??`: a blank stored display name must fall through to
 * the id-derived label rather than render blank.
 */
export const modelDisplayLabel = ({
  fullModelId,
  displayNames,
}: {
  fullModelId: string;
  displayNames?: Record<string, string>;
}): string => {
  return (
    displayNames?.[fullModelId] || fullModelId.split("/").slice(1).join("/")
  );
};
