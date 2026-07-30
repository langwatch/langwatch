import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "./constants";

/** Extracts provider key from model string (e.g., "openai/gpt-4" -> "openai") */
export function getProviderFromModel(model: string): string {
  return model.split("/")[0] ?? "";
}

/**
 * Extracts shape from Zod schema for credential keys.
 *
 * Providers whose credentials are valid in more than one combination wrap
 * their object in `.superRefine(...)` (openai and anthropic: either an API
 * key or a base URL), which hides `shape` behind `_def.schema`. Wrappers like
 * `.optional()` hide it behind `innerType()`. Unwrap both, or those providers
 * silently report no credential keys at all.
 */
export function getSchemaShape(schema: unknown): Record<string, unknown> {
  const s = schema as {
    shape?: Record<string, unknown>;
    innerType?: () => { shape?: Record<string, unknown> };
    _def?: { schema?: { shape?: Record<string, unknown> } };
  };
  if (s?.shape) return s.shape;
  if (s?._def?.schema) return s._def.schema.shape ?? {};
  if (typeof s?.innerType === "function") return s.innerType().shape ?? {};
  return {};
}

/** Whether a credential key holds a secret (drives password masking). */
export function isApiKeyField(key: string): boolean {
  return KEY_CHECK.some((k) => key.includes(k));
}

/**
 * Stand-in value used to ask the schema "does filling this field in change
 * anything?". Shaped like a URL so it also satisfies `.url()` fields; the
 * comparison is differential, so the exact value never leaks anywhere.
 */
const CREDENTIAL_PROBE_VALUE = "https://probe.invalid";

type ParsedIssue = { path?: (string | number)[]; message?: string };

function credentialIssues(
  keysSchema: unknown,
  values: Record<string, string>,
): Set<string> {
  const schema = keysSchema as {
    safeParse?: (value: unknown) => {
      success: boolean;
      error?: { issues?: ParsedIssue[] };
    };
  };
  if (typeof schema?.safeParse !== "function") return new Set();
  const result = schema.safeParse(values);
  if (result.success) return new Set();
  return new Set(
    (result.error?.issues ?? []).map(
      (issue) => `${(issue.path ?? []).join(".")}|${issue.message ?? ""}`,
    ),
  );
}

/**
 * Whether the schema objects to this key being blank, given everything else
 * the form currently holds. Differential rather than "did the parse fail":
 * an unrelated invalid field must not make every other field look required.
 */
function schemaDemandsKey({
  keysSchema,
  values,
  key,
}: {
  keysSchema: unknown;
  values: Record<string, string>;
  key: string;
}): boolean {
  const whenBlank = credentialIssues(keysSchema, { ...values, [key]: "" });
  if (whenBlank.size === 0) return false;
  const whenFilled = credentialIssues(keysSchema, {
    ...values,
    [key]: CREDENTIAL_PROBE_VALUE,
  });
  for (const issue of whenBlank) {
    if (!whenFilled.has(issue)) return true;
  }
  return false;
}

/**
 * Which credential fields the drawer marks required, right now.
 *
 * Requiredness is not a property of a field on its own: a provider that
 * accepts either an API key or a base URL (self-hosted endpoints commonly
 * run unauthenticated) needs the key only while no base URL is set. That
 * either/or lives in the provider's schema as a refinement, so the answer
 * is derived from the schema against the values entered so far, and it
 * moves as the customer types. Any provider that adopts the same shape
 * gets this for free, with nothing to declare.
 *
 * `optionalKeys` still declares the fields that are never required
 * (overrides with a working default, such as the base URL itself). The
 * schema may only relax requiredness from there, never tighten it: the
 * credential schemas are deliberately permissive so a key can also arrive
 * from an environment variable, which says nothing about what the customer
 * must type here.
 *
 * Values are trimmed before the schema sees them, so a field holding only
 * spaces counts as blank here whether or not the provider's own refinement
 * remembers to trim.
 */
export function getRequiredCredentialKeys({
  keysSchema,
  fieldSchemas,
  values,
  optionalKeys,
}: {
  keysSchema: unknown;
  fieldSchemas: Record<string, unknown>;
  values: Record<string, string>;
  optionalKeys?: readonly string[] | undefined;
}): Set<string> {
  const keys = Object.keys(fieldSchemas ?? {});
  const declaredOptional = optionalKeys ? new Set(optionalKeys) : undefined;
  const trimmedValues = Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      value?.trim() ?? "",
    ]),
  );
  const blankValues = Object.fromEntries(keys.map((key) => [key, ""]));

  const required = new Set<string>();
  for (const key of keys) {
    const isDeclaredRequired = declaredOptional
      ? !declaredOptional.has(key)
      : !(
          (
            fieldSchemas[key] as { isOptional?: () => boolean } | undefined
          )?.isOptional?.() ?? false
        );
    if (!isDeclaredRequired) continue;

    // Only a schema that demands this key on an empty form has an opinion
    // worth following. Otherwise the field is `.nullable().optional()` for
    // storage reasons alone and the declared answer stands.
    const alwaysDemanded = schemaDemandsKey({
      keysSchema,
      values: blankValues,
      key,
    });
    if (
      alwaysDemanded &&
      !schemaDemandsKey({ keysSchema, values: trimmedValues, key })
    ) {
      continue;
    }
    required.add(key);
  }
  return required;
}

/**
 * The credential fields still missing when the customer hits Save.
 * Used to place a schema-wide message (one that names no single field)
 * next to an input the customer can act on.
 */
export function getEmptyRequiredCredentialKeys({
  requiredKeys,
  values,
}: {
  requiredKeys: Set<string>;
  values: Record<string, string>;
}): string[] {
  return [...requiredKeys].filter((key) => (values[key] ?? "").trim() === "");
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
      AZURE_OPENAI_API_VERSION: schemaShape.AZURE_OPENAI_API_VERSION,
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
    } else if (isUsingEnvVars && isApiKeyField(key)) {
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
      isApiKeyField(key) &&
      value &&
      value.trim() !== "" &&
      value !== MASKED_KEY_PLACEHOLDER,
  );
}

/**
 * Whether one credential field now holds something other than what was
 * stored for it. Emptying a field counts: it is how a base URL gets
 * removed, and reading that as "nothing happened" left Save disabled with
 * no way to undo the endpoint.
 */
function credentialFieldChanged({
  value,
  storedValue,
}: {
  value: string | undefined;
  storedValue: unknown;
}): boolean {
  const current = value?.trim() ?? "";
  const stored = typeof storedValue === "string" ? storedValue.trim() : "";
  return current !== stored;
}

/**
 * Detects if user has modified any non-API-key fields (like URLs).
 * Used to determine if validation/save should run when using env vars.
 *
 * @param customKeys - The current form state
 * @param initialKeys - The initial stored keys (empty for env var providers)
 * @returns true if any non-API-key field differs from what was stored
 */
export function hasUserModifiedNonApiKeyFields(
  customKeys: Record<string, string>,
  initialKeys: Record<string, unknown>,
): boolean {
  return Object.entries(customKeys).some(
    ([key, value]) =>
      !isApiKeyField(key) &&
      credentialFieldChanged({ value, storedValue: initialKeys[key] }),
  );
}

/**
 * Whether any credential the customer can actually see has changed.
 * Fields still holding the masked placeholder are the ones they never
 * touched, so they are skipped rather than compared against a secret the
 * browser never receives.
 */
export function hasUserModifiedAnyCredential({
  customKeys,
  initialKeys,
}: {
  /** The current form state. */
  customKeys: Record<string, string>;
  /** The stored keys the form was seeded from. */
  initialKeys: Record<string, unknown>;
}): boolean {
  return Object.entries(customKeys).some(
    ([key, value]) =>
      value !== MASKED_KEY_PLACEHOLDER &&
      credentialFieldChanged({ value, storedValue: initialKeys[key] }),
  );
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
