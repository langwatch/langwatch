export const MASKED_KEY_PLACEHOLDER = "HAS_KEY••••••••••••••••••••••••";

export const PUBLIC_CREDENTIAL_FIELDS: ReadonlySet<string> = new Set([
  "ANTHROPIC_BASE_URL",
  "AWS_REGION_NAME",
  "AZURE_API_GATEWAY_BASE_URL",
  "AZURE_API_GATEWAY_VERSION",
  "AZURE_CONTENT_SAFETY_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_ENDPOINT",
  "CUSTOM_BASE_URL",
  "GEMINI_LOCATION",
  "GEMINI_PROJECT",
  "GOOGLE_AGENT_PLATFORM_LOCATION",
  "GOOGLE_AGENT_PLATFORM_PROJECT",
  "MANAGED",
  "OPENAI_BASE_URL",
  "VERTEXAI_LOCATION",
  "VERTEXAI_PROJECT",
]);

export function isSecretCredentialField(key: string): boolean {
  return !PUBLIC_CREDENTIAL_FIELDS.has(key);
}

/**
 * The credential field names a provider definition declares.
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
