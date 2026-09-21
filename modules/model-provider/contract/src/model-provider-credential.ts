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
 * Credentials whose exact bytes are the contract, exempt from the read-time
 * whitespace trim: each is cryptographic key material (an HMAC/SigV4 signing
 * key), where one changed byte changes every signature computed from it.
 */
export const EXACT_CREDENTIAL_FIELDS: ReadonlySet<string> = new Set([
  "AWS_SECRET_ACCESS_KEY",
  "ELEVENLABS_WEBHOOK_SECRET",
]);

/**
 * The credential field names a provider definition declares. Must unwrap refined/optional
 * schemas across both zod 3 (`ZodEffects`/`innerType()`) and zod 4 (`.unwrap()`/`_def.innerType`)
 * spellings, or affected providers silently render an empty credential form.
 */
export function getSchemaShape(schema: unknown, depth = 0): Record<string, unknown> {
  // Wrappers nest — `.optional().nullable()` is two of them — so this recurses,
  // and the bound is what keeps a cyclic or self-referential `_def` from
  // spinning rather than returning nothing.
  if (depth > 8) return {};

  const s = schema as {
    shape?: Record<string, unknown>;
    unwrap?: () => unknown;
    innerType?: (() => { shape?: Record<string, unknown> }) | unknown;
    _def?: { schema?: unknown; innerType?: unknown };
  };
  if (!s) return {};
  if (s.shape) return s.shape;
  if (s._def?.schema) return getSchemaShape(s._def.schema, depth + 1);

  // Zod 4 exposes a wrapper's inner schema as `.unwrap()` and as
  // `_def.innerType`; zod 3 exposed it as an `innerType()` METHOD. Both are
  // read, because the two majors coexist across this workspace's boundaries
  // and a schema can arrive from either.
  if (typeof s.unwrap === "function") return getSchemaShape(s.unwrap(), depth + 1);
  if (s._def?.innerType) return getSchemaShape(s._def.innerType, depth + 1);
  if (typeof s.innerType === "function") {
    return getSchemaShape((s.innerType as () => unknown)(), depth + 1);
  }
  return {};
}
