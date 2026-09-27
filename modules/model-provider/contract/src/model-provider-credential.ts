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
  "TWILIO_ACCOUNT_SID",
  "TWILIO_FROM_NUMBER",
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
 * The credential field names a provider definition declares, read through refinements and
 * wrappers, or affected providers silently render an empty credential form.
 */
export function getSchemaShape(schema: unknown, depth = 0): Record<string, unknown> {
  // Wrappers nest — `.optional().nullable()` is two of them — so this recurses,
  // and the bound is what keeps a self-referential wrapper from spinning.
  if (depth > 8 || typeof schema !== "object" || schema === null) return {};

  // Only public accessors: `.shape` on an object (zod 4 keeps it through `.superRefine`),
  // `.unwrap()` on either major's wrappers, `.innerType()` on zod 3's refinements.
  const shape: unknown = "shape" in schema ? schema.shape : undefined;
  if (typeof shape === "object" && shape !== null) return { ...shape };
  const unwrap: unknown = "unwrap" in schema ? schema.unwrap : undefined;
  if (typeof unwrap === "function") return getSchemaShape(unwrap.call(schema), depth + 1);
  const innerType: unknown = "innerType" in schema ? schema.innerType : undefined;
  if (typeof innerType === "function") return getSchemaShape(innerType.call(schema), depth + 1);
  return {};
}
