import {
  ModelProviderScopesRequiredError,
  findModelProviderDefinition,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderWriteInput,
} from "@langwatch/model-provider-contract";

type ProviderModelsForWrite = {
  customModels: ModelProvider["customModels"];
  customEmbeddingsModels: ModelProvider["customEmbeddingsModels"];
};

type ProviderRateLimitsForWrite = {
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
};

export function modelsForWrite(
  parsed: ModelProviderWriteInput,
  existing: ModelProvider | null,
): ProviderModelsForWrite {
  return {
    customModels:
      parsed.customModels === undefined
        ? (existing?.customModels ?? [])
        : (parsed.customModels ?? []),
    customEmbeddingsModels:
      parsed.customEmbeddingsModels === undefined
        ? (existing?.customEmbeddingsModels ?? [])
        : (parsed.customEmbeddingsModels ?? []),
  };
}

/** A save naming no scopes never moves a stored row; the page project only seeds a new row. */
export function scopesForWrite(
  input: ModelProviderWriteInput,
  existing: ModelProvider | null,
): ModelDefaultScope[] {
  if (input.scopes) return input.scopes;
  if (existing) return existing.scopes;
  if (input.projectId) return [{ scopeType: "PROJECT", scopeId: input.projectId }];

  throw new ModelProviderScopesRequiredError();
}

/** A default model sent with the save lands on the page's project, so its write is asked too. */
export function defaultScopeForWrite(input: ModelProviderWriteInput): ModelDefaultScope[] {
  return input.defaultModel !== undefined && input.projectId
    ? [{ scopeType: "PROJECT", scopeId: input.projectId }]
    : [];
}

export function rateLimitsForWrite(
  parsed: ModelProviderWriteInput,
  existing: ModelProvider | null,
): ProviderRateLimitsForWrite {
  return {
    rateLimitRpm:
      parsed.rateLimitRpm === undefined ? (existing?.rateLimitRpm ?? null) : parsed.rateLimitRpm,
    rateLimitTpm:
      parsed.rateLimitTpm === undefined ? (existing?.rateLimitTpm ?? null) : parsed.rateLimitTpm,
    rateLimitRpd:
      parsed.rateLimitRpd === undefined ? (existing?.rateLimitRpd ?? null) : parsed.rateLimitRpd,
    fallbackPriorityGlobal:
      parsed.fallbackPriorityGlobal === undefined
        ? (existing?.fallbackPriorityGlobal ?? null)
        : parsed.fallbackPriorityGlobal,
  };
}

/** A new row's default name: the registry's name, the one the drawer shows, else the key. */
export function humanize(provider: string): string {
  const registered = findModelProviderDefinition(provider)?.name;
  if (registered) return registered;
  return provider.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The skip-permissions list this write stores. Omitting the field leaves
 * the stored list alone; an empty list clears it, so the registry default
 * applies — stored as null, not an empty array reading as "trust nothing".
 */
export function deriveSkipPermissionsForWrite(
  parsed: ModelProviderWriteInput,
  existing: ModelProvider | null,
): string[] | null {
  if (parsed.langySkipPermissionsModels === undefined) {
    return existing?.langySkipPermissionsModels ?? null;
  }

  return (parsed.langySkipPermissionsModels?.length ?? 0) > 0
    ? (parsed.langySkipPermissionsModels ?? null)
    : null;
}
