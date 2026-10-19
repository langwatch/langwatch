import type { ModelProviderScopeType } from "./model-provider.ts";

/**
 * What a label is chosen from. The scope tier and the two custom-model columns come
 * from stored JSON, so they are read as found, not as the editor types promise.
 */
export type CustomModelDisplayNameRow = {
  id?: string;
  provider: string;
  enabled: boolean;
  scopeType?: string;
  scopes?: readonly { scopeType: string }[];
  customModels?: unknown;
  customEmbeddingsModels?: unknown;
};

const SCOPE_RANK: Record<ModelProviderScopeType, number> = {
  PROJECT: 0,
  TEAM: 1,
  ORGANIZATION: 2,
};
const UNSCOPED_RANK = 3;

function rankOf(scopeType: string | undefined): number {
  if (scopeType === "PROJECT") return SCOPE_RANK.PROJECT;
  if (scopeType === "TEAM") return SCOPE_RANK.TEAM;
  if (scopeType === "ORGANIZATION") return SCOPE_RANK.ORGANIZATION;
  return UNSCOPED_RANK;
}

function scopeRank(row: CustomModelDisplayNameRow): number {
  const scopeTypes = row.scopes?.length
    ? row.scopes.map((scope) => scope.scopeType)
    : [row.scopeType];
  return Math.min(...scopeTypes.map(rankOf));
}

function precedence(row: CustomModelDisplayNameRow): readonly [0 | 1, number, 0 | 1, string] {
  return [row.enabled ? 0 : 1, scopeRank(row), row.id ? 0 : 1, row.id ?? ""] as const;
}

function compareIds(id: string, theirId: string): number {
  if (id === theirId) return 0;
  return id < theirId ? -1 : 1;
}

function compareRows(left: CustomModelDisplayNameRow, right: CustomModelDisplayNameRow): number {
  const [enabled, scope, persisted, id] = precedence(left);
  const [theirEnabled, theirScope, theirPersisted, theirId] = precedence(right);
  return (
    enabled - theirEnabled ||
    scope - theirScope ||
    persisted - theirPersisted ||
    compareIds(id, theirId)
  );
}

function customEntriesOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The entries that carry both a model id and a label as text, with the label trimmed. */
function configuredEntries(
  entries: readonly unknown[],
): { modelId: string; displayName: string }[] {
  return entries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const modelId = "modelId" in entry ? entry.modelId : undefined;
    if (typeof modelId !== "string" || !modelId.trim()) return [];
    const rawDisplayName = "displayName" in entry ? entry.displayName : undefined;
    if (typeof rawDisplayName !== "string") return [];

    const displayName = rawDisplayName.trim();
    if (!displayName || displayName === modelId) return [];
    return [{ modelId, displayName }];
  });
}

/** Builds deterministic labels for custom chat and embedding models. */
export function buildCustomModelDisplayNames(
  modelProviders: readonly CustomModelDisplayNameRow[],
): Record<string, string> {
  const displayNames: Record<string, string> = {};

  for (const row of [...modelProviders].toSorted(compareRows)) {
    const entries = [
      ...customEntriesOf(row.customModels),
      ...customEntriesOf(row.customEmbeddingsModels),
    ];
    for (const { modelId, displayName } of configuredEntries(entries)) {
      const keys = [`${row.provider}/${modelId}`];
      if (row.id) keys.push(`${row.id}/${modelId}`);
      for (const key of keys) displayNames[key] ??= displayName;
    }
  }

  return displayNames;
}

/** Resolves a configured label, falling back to the model family name. */
export function modelDisplayLabel({
  fullModelId,
  displayNames,
}: {
  fullModelId: string;
  displayNames?: Record<string, string>;
}): string {
  return displayNames?.[fullModelId] || fullModelId.split("/").slice(1).join("/");
}
