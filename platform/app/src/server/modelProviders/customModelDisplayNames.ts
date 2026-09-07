import type { ScopeTier } from "../scopes/scope.types";
import type { CustomModelEntry } from "./customModel.schema";
import type { MaybeStoredModelProvider } from "./registry";

/**
 * Narrowest scope first. A row with no scope — or one this ranking does
 * not know — ranks last.
 *
 * `satisfies Record<ScopeTier, number>` binds the table to the shared
 * tier type, so a fourth tier lands as a compile error here rather than
 * as an unranked value at runtime.
 */
const SCOPE_RANK = {
  PROJECT: 0,
  TEAM: 1,
  ORGANIZATION: 2,
} as const satisfies Record<ScopeTier, number>;
const UNSCOPED_RANK = 3;

/**
 * Ranks a single scope tier, ranking anything this table doesn't know as
 * unscoped.
 *
 * The guard is not redundant with the parameter type. `registry.ts`
 * spells the tier union out by hand instead of deriving it from
 * `ScopeTier`, and `modelProvider.service.ts` casts the Prisma enum into
 * it unchecked, so a value outside the table compiles green and arrives
 * here at runtime. It must rank as *something*: a bare lookup returns
 * `undefined`, which `Math.min` turns into `NaN`. A `NaN` tier does not
 * merely rank the row wrongly — `NaN` minus anything is `NaN`, which is
 * falsy, so the scope tier drops out of `byPrecedence` altogether and a
 * PROJECT row loses the authority to outrank an unscoped one. Given three
 * or more rows the comparator turns intransitive too, and which row wins a
 * key comes down to the order rows happen to arrive in.
 *
 * An OWN-property check, not `in`: `in` also accepts INHERITED keys, so
 * `"toString"` passes it and resolves to `Object.prototype.toString` — a
 * function, which `Math.min` turns into exactly the `NaN` this guard
 * exists to prevent, re-opening the hole one tier lower. Every
 * `Object.prototype` member is reachable this way (`toString`, `valueOf`,
 * `constructor`, `hasOwnProperty`, `__proto__`); only an own-property
 * check ranks them all as unscoped.
 */
const rankOf = (scopeType: string | undefined): number =>
  scopeType && Object.hasOwn(SCOPE_RANK, scopeType)
    ? SCOPE_RANK[scopeType as ScopeTier]
    : UNSCOPED_RANK;

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

  return Math.min(...scopeTypes.map(rankOf));
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
 * gap: both synthesizers of id-less rows — `buildDefaultProviders` and
 * `buildDefaultProvidersFromEnvShape`, which backs the managed-bedrock
 * system row — make at most one row per provider and never give it
 * custom models.
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
  [
    row.enabled ? 0 : 1, // enabled: before disabled
    scopeRank(row), // narrowest scope: PROJECT, then TEAM, then ORGANIZATION
    row.id ? 0 : 1, // persisted: before synthesized
    row.id ?? "", // lowest id: settles the rest reproducibly
  ] as const;

/** Orders rows best-first: lexicographic over `precedence`, lower wins. */
const byPrecedence = (
  left: MaybeStoredModelProvider,
  right: MaybeStoredModelProvider,
): number => {
  const [enabled, scope, persisted, id] = precedence(left);
  const [theirEnabled, theirScope, theirPersisted, theirId] = precedence(right);

  return (
    enabled - theirEnabled ||
    scope - theirScope ||
    persisted - theirPersisted ||
    (id === theirId ? 0 : id < theirId ? -1 : 1)
  );
};

const customEntriesOf = (
  value: CustomModelEntry[] | null | undefined,
): CustomModelEntry[] => (Array.isArray(value) ? value : []);

/**
 * The Display Name a user chose for this entry, or null when the entry
 * carries none. An entry names nothing when its `modelId` is not a string
 * or is blank, when its `displayName` is not a string or is blank, or
 * when the name merely repeats the `modelId`.
 *
 * That last case is what `toLegacyCompatibleCustomModels` synthesizes for
 * a legacy `string[]` row: an artifact of the conversion rather than a
 * name anyone chose. Dropping it costs the entry's own label nothing,
 * since `modelDisplayLabel` falls back to exactly that model id anyway.
 * Where it does decide something — deliberately — is when another row
 * names the same model: the artifact never competes, so the real name
 * wins the key even from a row the artifact's row would outrank.
 *
 * `modelId` is rejected on the same terms as `displayName` — blank after
 * trimming, not merely empty. `customModelEntrySchema`'s `min(1)` does not
 * screen `"   "` out (it is three characters long), and
 * `toLegacyCompatibleCustomModels` casts its elements through unchecked,
 * so an all-whitespace id reaches here from a hand-edited or migrated JSON
 * row. Naming it would key the map `<provider>/   ` — a key no caller can
 * ever hold, since a full model id is built from a real id.
 *
 * Only the all-whitespace case is rejected; the id is NOT trimmed for the
 * key. An id with real content and incidental spaces keys on its stored
 * form, because the value a picker holds comes from that same stored
 * field — trimming here would name a model the caller never asks about.
 */
const configuredDisplayName = (entry: CustomModelEntry): string | null => {
  const modelId = entry?.modelId;
  if (typeof modelId !== "string" || !modelId.trim()) return null;
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
 * unnamed entry costs no other row its name. That guard is load-bearing:
 * `toLegacyCompatibleCustomModels` returns `[]` for anything that is not
 * an array, so the list is always a list, but it casts the ELEMENTS
 * through unchecked — these are JSON columns, so a hand-edited or
 * migrated row can reach here holding an entry of any shape.
 * `customEntriesOf`'s own array check is belt-and-braces on top of that
 * guarantee, since every current path routes through that converter; it
 * earns its place by also turning an absent list into an empty one.
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
 * `||`, not `??`: a blank name must fall through to the id-derived label
 * rather than render blank. `buildCustomModelDisplayNames` cannot hand
 * one over — `configuredDisplayName` rejects blanks — but this is an
 * exported entry point whose map is a plain `Record<string, string>`,
 * with nothing tying it to that builder, so the guard stays.
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
