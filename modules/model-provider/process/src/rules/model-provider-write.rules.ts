import type { ModelProvider, ModelProviderWriteInput } from "@langwatch/model-provider-contract";

export type ProviderModelsForWrite = {
  customModels: ModelProvider["customModels"];
  customEmbeddingsModels: ModelProvider["customEmbeddingsModels"];
};

export type ProviderRateLimitsForWrite = {
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

export function humanize(provider: string): string {
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
