import type { CustomModelEntry } from "./customModel.schema";
import type { MaybeStoredModelProvider } from "./registry";

/**
 * Builds a lookup of `<provider>/<modelId>` -> configured Display Name
 * for every custom model across all providers, chat and embeddings
 * alike. Mirrors `mergeCustomModelMetadata`'s dual-list walk
 * (src/server/api/routers/modelProviders.utils.ts) so the one map
 * serves every `ProviderModelSelector` instance, whatever role it's
 * rendering for.
 *
 * Entries with no `modelId` or a blank/absent `displayName` are
 * omitted — the column is JSON and `toLegacyCompatibleCustomModels`
 * returns an unchecked cast, so malformed rows can reach here.
 */
export const buildCustomModelDisplayNames = (
  modelProviders: Record<string, MaybeStoredModelProvider>,
): Record<string, string> => {
  const displayNames: Record<string, string> = {};

  for (const [providerKey, config] of Object.entries(modelProviders)) {
    const entries: CustomModelEntry[] = [
      ...(config.customModels ?? []),
      ...(config.customEmbeddingsModels ?? []),
    ];

    for (const entry of entries) {
      if (!entry?.modelId || !entry.displayName) continue;
      displayNames[`${providerKey}/${entry.modelId}`] = entry.displayName;
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
export const modelDisplayLabel = (
  fullModelId: string,
  displayNames?: Record<string, string>,
): string => {
  return (
    displayNames?.[fullModelId] || fullModelId.split("/").slice(1).join("/")
  );
};
