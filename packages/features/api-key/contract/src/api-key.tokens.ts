/**
 * Public token-format facts shared by API-key transports and the server
 * implementation. Hashing and token generation stay server-owned because
 * they require process credentials; parsing a token is portable.
 */
export const API_KEY_PREFIX = "sk-lw-";
export const LEGACY_PAT_PREFIX = "pat-lw-";
export const INGEST_KEY_PREFIX = "ik-lw-";

const API_KEY_BODY_REGEX = /^[0-9A-Za-z]{16}_[0-9A-Za-z]{48}$/;

export function splitApiKeyToken(
  token: string,
): { lookupId: string; secret: string } | null {
  const prefix = [
    LEGACY_PAT_PREFIX,
    INGEST_KEY_PREFIX,
    API_KEY_PREFIX,
  ].find((candidate) => token.startsWith(candidate));
  if (!prefix) return null;

  const body = token.slice(prefix.length);
  const separatorIndex = body.indexOf("_");
  if (separatorIndex < 1 || separatorIndex === body.length - 1) return null;

  const lookupId = body.slice(0, separatorIndex);
  const secret = body.slice(separatorIndex + 1);
  return lookupId && secret ? { lookupId, secret } : null;
}

export type ApiKeyTokenType = "apiKey" | "legacyProjectKey" | "unknown";

export function getTokenType(token: string): ApiKeyTokenType {
  if (token.startsWith(LEGACY_PAT_PREFIX)) return "apiKey";
  if (token.startsWith(INGEST_KEY_PREFIX)) return "apiKey";
  if (!token.startsWith(API_KEY_PREFIX)) return "unknown";

  return API_KEY_BODY_REGEX.test(token.slice(API_KEY_PREFIX.length))
    ? "apiKey"
    : "legacyProjectKey";
}
