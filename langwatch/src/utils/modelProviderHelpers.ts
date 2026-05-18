import { getProviderModelOptions } from "../server/modelProviders/registry";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "./constants";

/** Extracts provider key from model string (e.g., "openai/gpt-4" -> "openai") */
export function getProviderFromModel(model: string): string {
  return model.split("/")[0] ?? "";
}

/**
 * Determines whether a model is disabled for generation.
 * When `modelOption` is present (model is in the static registry), delegates to its `isDisabled` flag.
 * When `modelOption` is absent (e.g., custom Azure deployment not in registry), falls back to
 * checking whether the model's provider is enabled in the project's provider settings.
 */
export function isModelDisabledForProvider({
  modelOption,
  providers,
  model,
}: {
  modelOption: { isDisabled: boolean } | undefined;
  providers: Record<string, { enabled: boolean }> | undefined;
  model: string;
}): boolean {
  if (modelOption) return modelOption.isDisabled;
  const providerKey = getProviderFromModel(model);
  return !(providers?.[providerKey]?.enabled ?? false);
}

/** Extracts shape from Zod schema for credential keys */
export function getSchemaShape(schema: unknown): Record<string, unknown> {
  const s = schema as {
    shape?: Record<string, unknown>;
    _def?: { schema?: { shape?: Record<string, unknown> } };
  };
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

/**
 * Detects if user has entered a new (non-masked) API key in the form.
 * Used to determine if validation should run even when provider uses env vars.
 *
 * @param customKeys - The form state containing API keys
 * @returns true if user entered a real API key value (not masked, not empty)
 */
export function hasUserEnteredNewApiKey(
  customKeys: Record<string, string>,
): boolean {
  return Object.entries(customKeys).some(
    ([key, value]) =>
      KEY_CHECK.some((k) => key.includes(k)) &&
      value &&
      value.trim() !== "" &&
      value !== MASKED_KEY_PLACEHOLDER,
  );
}

/**
 * Detects if user has modified any non-API-key fields (like URLs).
 * Used to determine if validation/save should run when using env vars.
 *
 * @param customKeys - The current form state
 * @param initialKeys - The initial stored keys (empty for env var providers)
 * @returns true if any non-API-key field has a non-empty value
 */
export function hasUserModifiedNonApiKeyFields(
  customKeys: Record<string, string>,
  initialKeys: Record<string, unknown>,
): boolean {
  return Object.entries(customKeys).some(([key, value]) => {
    // Skip API key fields
    if (KEY_CHECK.some((k) => key.includes(k))) {
      return false;
    }
    // Check if value is non-empty and different from initial
    const initialValue = initialKeys[key];
    const currentValue = value?.trim() ?? "";
    const storedValue =
      typeof initialValue === "string" ? initialValue.trim() : "";
    return currentValue !== "" && currentValue !== storedValue;
  });
}

/**
 * Filters customKeys to remove masked API keys before sending to backend.
 * Used when env var provider has modified URL fields.
 *
 * @param customKeys - The form state containing API keys and other fields
 * @returns Object with masked API keys removed
 */
export function filterMaskedApiKeys(
  customKeys: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(customKeys).filter(
      ([_, value]) => value !== MASKED_KEY_PLACEHOLDER,
    ),
  );
}

/**
 * Resolves a model string for a specific provider.
 * If the current model already belongs to the provider, returns it unchanged.
 * Otherwise, picks the first available model from stored models or registry.
 *
 * @param params.current - The current model string (e.g., "openai/gpt-4o")
 * @param params.providerKey - The provider key (e.g., "openai")
 * @param params.storedModels - Provider's stored models (custom or persisted)
 * @param params.mode - Whether to look up "chat" or "embedding" models
 * @returns A model string prefixed with the provider key
 */
export function resolveModelForProvider({
  current,
  providerKey,
  storedModels,
  mode,
}: {
  current: string;
  providerKey: string;
  storedModels: string[] | null | undefined;
  mode: "chat" | "embedding";
}): string {
  if (current.startsWith(`${providerKey}/`)) return current;
  if (storedModels?.length)
    return `${providerKey}/${storedModels[0]}`;
  const registryModels = getProviderModelOptions(providerKey, mode);
  if (registryModels.length > 0)
    return `${providerKey}/${registryModels[0]!.value}`;
  return current;
}

/**
 * Determines whether the "Use as Default Provider" toggle should be
 * auto-enabled when opening the drawer. With the legacy default-model
 * scalar columns gone, only the "first provider in the project" case
 * remains: any further provider added needs an explicit opt-in.
 */
export function shouldAutoEnableAsDefault({
  enabledProvidersCount,
}: {
  enabledProvidersCount: number;
}): boolean {
  return enabledProvidersCount <= 1;
}
