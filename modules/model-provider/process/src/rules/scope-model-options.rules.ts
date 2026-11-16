/**
 * The models a Default models config may pick, from the providers each of its scopes runs on:
 * only those every scope runs, as the decision-model column already does.
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import {
  buildCustomModelDisplayNames,
  catalogueModelIdsFor,
  LATEST_ALIAS_PROVIDERS,
  listsOnlyAddedModels,
  type EmptyScopeProvider,
  type ModelProviderSummary,
  type ScopeModelOptions,
} from "@langwatch/model-provider-contract";

type ScopeProviderRow = Pick<
  ModelProviderSummary,
  "id" | "provider" | "name" | "enabled" | "scopes" | "customModels" | "customEmbeddingsModels"
> & { isSystem?: boolean };

type Mode = "chat" | "embedding";

function customModelsOf({ row, mode }: { row: ScopeProviderRow; mode: Mode }) {
  return mode === "chat" ? row.customModels : row.customEmbeddingsModels;
}

/** "Latest" aliases first, then the provider's own models, then the catalogue's. */
function modelIdsForScope({ rows, mode }: { rows: readonly ScopeProviderRow[]; mode: Mode }) {
  const enabled = rows.filter((row) => row.enabled);
  const keys = new Set(enabled.map((row) => row.provider));
  const aliases =
    mode === "chat"
      ? LATEST_ALIAS_PROVIDERS.filter((provider) => keys.has(provider)).flatMap((provider) => [
          `${provider}/latest`,
          `${provider}/latest-mini`,
        ])
      : [];
  const custom = enabled.flatMap((row) =>
    customModelsOf({ row, mode }).map((model) => `${row.provider}/${model.id}`),
  );
  const catalogue = [...keys].flatMap((provider) => catalogueModelIdsFor({ provider, mode }));
  return [...new Set([...aliases, ...custom, ...catalogue])];
}

function runByEvery(lists: readonly string[][]): string[] {
  const [first = [], ...rest] = lists;
  const others = rest.map((list) => new Set(list));
  return first.filter((model) => others.every((list) => list.has(model)));
}

function emptyProvidersOf({ rows, mode }: { rows: readonly ScopeProviderRow[]; mode: Mode }) {
  const named = new Map<string, EmptyScopeProvider>();
  for (const row of rows) {
    if (!row.enabled || !listsOnlyAddedModels({ provider: row.provider })) continue;
    if (customModelsOf({ row, mode }).length > 0) continue;
    named.set(row.id, {
      id: row.id,
      provider: row.provider,
      name: row.name,
      isSystem: row.isSystem ?? false,
    });
  }
  return [...named.values()];
}

/**
 * The rows a scope runs, chosen per model as execution resolves one: each added model's best
 * enabled row, then the best row of each provider key that serves no added model.
 */
export function servingRowsOf<Row extends ScopeProviderRow>({
  rows,
  compare,
}: {
  rows: readonly Row[];
  compare: (left: Row, right: Row) => number;
}): Row[] {
  const ranked = rows.toSorted(compare);
  const serving = new Set<Row>();
  const served = new Set<string>();
  for (const row of ranked.filter((candidate) => candidate.enabled)) {
    for (const mode of ["chat", "embedding"] as const) {
      for (const model of customModelsOf({ row, mode })) {
        const key = `${mode}:${row.provider}/${model.id}`;
        if (served.has(key)) continue;
        served.add(key);
        serving.add(row);
      }
    }
  }
  const servingKeys = new Set([...serving].map((row) => row.provider));
  const unserved = new Map<string, Row>();
  for (const row of ranked) {
    if (!servingKeys.has(row.provider) && !unserved.has(row.provider)) {
      unserved.set(row.provider, row);
    }
  }
  return [...serving, ...unserved.values()];
}

/** One list of provider rows per picked scope, each the rows that scope runs its models on. */
export function scopeModelOptionsOf({
  rowsByScope,
}: {
  rowsByScope: readonly (readonly ScopeProviderRow[])[];
}): ScopeModelOptions {
  const rows = rowsByScope.flat();
  const displayNames = buildCustomModelDisplayNames(
    rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      enabled: row.enabled,
      scopes: row.scopes,
      customModels: row.customModels.map((model) => ({
        modelId: model.id,
        displayName: model.label,
      })),
      customEmbeddingsModels: row.customEmbeddingsModels.map((model) => ({
        modelId: model.id,
        displayName: model.label,
      })),
    })),
  );

  return {
    chat: runByEvery(
      rowsByScope.map((scopeRows) => modelIdsForScope({ rows: scopeRows, mode: "chat" })),
    ),
    embedding: runByEvery(
      rowsByScope.map((scopeRows) => modelIdsForScope({ rows: scopeRows, mode: "embedding" })),
    ),
    displayNames,
    emptyProviders: {
      chat: emptyProvidersOf({ rows, mode: "chat" }),
      embedding: emptyProvidersOf({ rows, mode: "embedding" }),
    },
  };
}
