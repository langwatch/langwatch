import {
  buildCustomModelDisplayNames,
  catalogueModelIdsFor,
  LATEST_ALIAS_PROVIDERS,
  NO_SCOPE_MODEL_OPTIONS,
  type ScopeModelOptions,
} from "@langwatch/model-provider-contract";

type FixtureRow = {
  provider: string;
  enabled: boolean;
  customModels?: { modelId: string; displayName?: string }[];
  customEmbeddingsModels?: { modelId: string; displayName?: string }[];
};

/** What the scope models read answers for one scope holding these rows: a double, not the rule. */
export function scopeModelOptionsFor(rows: readonly FixtureRow[]): ScopeModelOptions {
  const enabled = rows.filter((row) => row.enabled);
  const keys = [...new Set(enabled.map((row) => row.provider))];
  const custom = (pick: (row: FixtureRow) => FixtureRow["customModels"]) =>
    enabled.flatMap((row) => (pick(row) ?? []).map((model) => `${row.provider}/${model.modelId}`));
  return {
    ...NO_SCOPE_MODEL_OPTIONS,
    chat: [
      ...new Set([
        ...LATEST_ALIAS_PROVIDERS.filter((key) => keys.includes(key)).flatMap((key) => [
          `${key}/latest`,
          `${key}/latest-mini`,
        ]),
        ...custom((row) => row.customModels),
        ...keys.flatMap((provider) => catalogueModelIdsFor({ provider, mode: "chat" })),
      ]),
    ],
    embedding: [
      ...new Set([
        ...custom((row) => row.customEmbeddingsModels),
        ...keys.flatMap((provider) => catalogueModelIdsFor({ provider, mode: "embedding" })),
      ]),
    ],
    displayNames: buildCustomModelDisplayNames(rows),
  };
}

/** The read's answer for a mocked `{ data: rows }` result, keeping its loading and error flags. */
export function scopeAnswerFor(
  result: { data?: readonly FixtureRow[]; isLoading?: boolean; isError?: boolean } | undefined,
) {
  return { ...result, data: result?.data ? scopeModelOptionsFor(result.data) : undefined };
}
