import type { CustomModelEntry } from "./custom-model";
import type { ModelProviderEditorValue } from "./model-provider-registry";
import type { ModelProviderScopeType } from "./model-provider";

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

function scopeRank(row: ModelProviderEditorValue): number {
  const scopeTypes = row.scopes?.length
    ? row.scopes.map((scope) => scope.scopeType)
    : [row.scopeType];
  return Math.min(...scopeTypes.map(rankOf));
}

function precedence(row: ModelProviderEditorValue) {
  return [row.enabled ? 0 : 1, scopeRank(row), row.id ? 0 : 1, row.id ?? ""] as const;
}

function compareRows(left: ModelProviderEditorValue, right: ModelProviderEditorValue): number {
  const [enabled, scope, persisted, id] = precedence(left);
  const [theirEnabled, theirScope, theirPersisted, theirId] = precedence(right);
  return (
    enabled - theirEnabled ||
    scope - theirScope ||
    persisted - theirPersisted ||
    (id === theirId ? 0 : id < theirId ? -1 : 1)
  );
}

function customEntriesOf(value: CustomModelEntry[] | null | undefined): CustomModelEntry[] {
  return Array.isArray(value) ? value : [];
}

function configuredDisplayName(entry: CustomModelEntry): string | null {
  const modelId = entry?.modelId;
  if (typeof modelId !== "string" || !modelId.trim()) return null;
  if (typeof entry.displayName !== "string") return null;

  const displayName = entry.displayName.trim();
  if (!displayName || displayName === modelId) return null;
  return displayName;
}

/** Builds deterministic labels for custom chat and embedding models. */
export function buildCustomModelDisplayNames(
  modelProviders: readonly ModelProviderEditorValue[],
): Record<string, string> {
  const displayNames: Record<string, string> = {};

  for (const row of [...modelProviders].sort(compareRows)) {
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
