import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  KEY_CHECK,
  MASKED_KEY_PLACEHOLDER,
} from "./constants";

/** Extracts provider key from model string (e.g., "openai/gpt-4" -> "openai") */
export function getProviderFromModel(model: string): string {
  return model.split("/")[0] ?? "";
}

export type EffectiveDefaults = {
  defaultModel: string;
  topicClusteringModel: string;
  embeddingsModel: string;
};

/** Returns project defaults with fallbacks to DEFAULT_* constants */
export function getEffectiveDefaults(
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined
): EffectiveDefaults {
  return {
    defaultModel: project?.defaultModel ?? DEFAULT_MODEL,
    topicClusteringModel: project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
    embeddingsModel: project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
  };
}

/** Checks if provider is used for ANY effective default (used for delete prevention) */
export function isProviderEffectiveDefault(
  providerKey: string,
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined
): boolean {
  const effectiveDefaults = getEffectiveDefaults(project);
  return isProviderUsedForDefaultModels(
    providerKey,
    effectiveDefaults.defaultModel,
    effectiveDefaults.topicClusteringModel,
    effectiveDefaults.embeddingsModel
  );
}

/** Checks if provider is used for the Default Model only (used for badge and toggle logic) */
export function isProviderDefaultModel(
  providerKey: string,
  project: {
    defaultModel?: string | null;
  } | null | undefined
): boolean {
  const effectiveDefault = project?.defaultModel ?? DEFAULT_MODEL;
  return getProviderFromModel(effectiveDefault) === providerKey;
}

/** Checks if provider matches any of the given model strings (used in delete dialog) */
export function isProviderUsedForDefaultModels(
  providerKey: string,
  defaultModel: string | null,
  topicClusteringModel: string | null,
  embeddingsModel: string | null
): boolean {
  const defaultProvider = defaultModel ? getProviderFromModel(defaultModel) : null;
  const topicClusteringProvider = topicClusteringModel
    ? getProviderFromModel(topicClusteringModel)
    : null;
  const embeddingsProvider = embeddingsModel
    ? getProviderFromModel(embeddingsModel)
    : null;

  return (
    providerKey === defaultProvider ||
    providerKey === topicClusteringProvider ||
    providerKey === embeddingsProvider
  );
}

/** Extracts shape from Zod schema for credential keys */
export function getSchemaShape(schema: unknown): Record<string, unknown> {
  const s = schema as { shape?: Record<string, unknown>; _def?: { schema?: { shape?: Record<string, unknown> } } };
  if (s?.shape) return s.shape;
  if (s?._def?.schema) return s._def.schema.shape ?? {};
  return {};
}

/** Returns visible credential keys for provider (Azure has special API Gateway handling) */
export function getDisplayKeysForProvider(
  providerName: string,
  useApiGateway: boolean,
  schemaShape: Record<string, unknown>,
): Record<string, unknown> {
  if (providerName === "azure") {
    if (useApiGateway) {
      return {
        AZURE_API_GATEWAY_BASE_URL: schemaShape.AZURE_API_GATEWAY_BASE_URL,
        AZURE_API_GATEWAY_VERSION: schemaShape.AZURE_API_GATEWAY_VERSION,
      };
    }
    return {
      AZURE_OPENAI_API_KEY: schemaShape.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_ENDPOINT: schemaShape.AZURE_OPENAI_ENDPOINT,
    };
  }

  return schemaShape;
}

/** Builds credential form state, preserving prior user input.
 * When provider is enabled but has no stored keys (using env vars),
 * API key fields will show MASKED_KEY_PLACEHOLDER.
 */
export function buildCustomKeyState(
  displayKeyMap: Record<string, unknown>,
  storedKeys: Record<string, unknown>,
  previousKeys?: Record<string, string>,
  options?: { providerEnabledWithEnvVars?: boolean },
): Record<string, string> {
  if (previousKeys?.MANAGED) {
    return previousKeys;
  }
  const result: Record<string, string> = {};
  const hasStoredKeys = Object.keys(storedKeys ?? {}).length > 0;
  const isUsingEnvVars = options?.providerEnabledWithEnvVars && !hasStoredKeys;

  Object.keys(displayKeyMap ?? {}).forEach((key) => {
    if (
      previousKeys &&
      Object.prototype.hasOwnProperty.call(previousKeys, key)
    ) {
      const previousValue = previousKeys[key];
      if (typeof previousValue === "string") {
        result[key] = previousValue;
        return;
      }
    }

    const storedValue = storedKeys[key];
    if (typeof storedValue === "string") {
      result[key] = storedValue;
    } else if (isUsingEnvVars && KEY_CHECK.some((k) => key.includes(k))) {
      // Provider is enabled via env vars - show MASKED for API key fields
      result[key] = MASKED_KEY_PLACEHOLDER;
    } else {
      result[key] = "";
    }
  });

  return result;
}
