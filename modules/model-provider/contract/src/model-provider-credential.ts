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
 * Providers whose credentials are valid in more than one combination refine
 * their object (openai and anthropic: either an API key or a base URL), and
 * wrappers like `.optional()` hide `shape` a level down. Unwrap them, or those
 * providers silently report no credential keys at all — which is a provider
 * whose credential form renders empty, not an error anyone would see.
 *
 * Where each major puts the inner schema differs, and this reads all of them:
 * zod 3 wrapped a refined object in a `ZodEffects` (`_def.schema`) and exposed
 * a wrapper's inner schema as an `innerType()` method; zod 4 refines in place,
 * so `shape` is simply there, and a wrapper answers `.unwrap()` or
 * `_def.innerType`. Reading only zod 3's spellings is how the `.optional()`
 * case started returning nothing at all on the upgrade.
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
