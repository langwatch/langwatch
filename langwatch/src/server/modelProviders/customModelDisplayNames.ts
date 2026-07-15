import type { CustomModelEntry } from "./customModel.schema";
import type { MaybeStoredModelProvider } from "./registry";

/**
 * Builds a lookup of `<provider>/<modelId>` -> configured Display Name
 * for every custom model on the given provider rows, chat and
 * embeddings alike, so one map serves every role a picker renders.
 *
 * Takes rows rather than a `Record` keyed by provider: a provider can
 * be stored at several scopes, and collapsing those rows by key first
 * would drop one row's custom models on the floor.
 *
 * Two rows of the same provider defining the SAME `modelId` with
 * different display names resolve to whichever row the query returned
 * last. `findAllAccessibleForProject` issues a bare `findMany` with no
 * `orderBy`, so row order carries no scope precedence — picking the
 * first instead of the last would be equally arbitrary, and no
 * precedence rule exists elsewhere in the picker to mirror. Both rows
 * key to the same `<provider>/<modelId>`, so only the label is
 * ambiguous; the stored value is identical either way.
 *
 * Not to be confused with `mergeCustomModelMetadata`
 * (src/server/api/routers/modelProviders.utils.ts), which also reads
 * `displayName` off these same lists. Its record is keyed by model-
 * provider id, not provider type, so the two key spaces don't join —
 * it answers "what can this model do", this answers "what do we call
 * it".
 *
 * Entries with no `modelId`, or whose `displayName` is absent or only
 * whitespace, are omitted — the column is JSON and
 * `toLegacyCompatibleCustomModels` returns an unchecked cast, so
 * malformed rows can reach here.
 */
export const buildCustomModelDisplayNames = (
  modelProviders: readonly MaybeStoredModelProvider[],
): Record<string, string> => {
  const displayNames: Record<string, string> = {};

  for (const config of modelProviders) {
    const entries: CustomModelEntry[] = [
      ...(config.customModels ?? []),
      ...(config.customEmbeddingsModels ?? []),
    ];

    for (const entry of entries) {
      const displayName = entry?.displayName?.trim();
      if (!entry?.modelId || !displayName) continue;
      displayNames[`${config.provider}/${entry.modelId}`] = displayName;
    }
  }

  return displayNames;
};

/**
 * Resolves the label to render for a full model id
 * (`<provider>/<modelId>`): the configured custom display name when
 * one exists, otherwise the id's family part — the same fallback
 * every selector used before display names existed.
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
