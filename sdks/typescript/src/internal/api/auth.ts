/**
 * Authentication header assembly for LangWatch SDK clients. Supports two token families: (1)
 * `sk-lw-{random}` legacy project keys, which carry project identity themselves, so we emit
 * both `Authorization: Bearer` and `X-Auth-Token` for backward compat; (2)
 * `sk-lw-{lookupId}_{secret}` / `pat-lw-{lookupId}_{secret}` user-scoped keys, paired with a
 * `projectId` (when available) as `Authorization: Basic base64(projectId:token)` so the server
 * can resolve the role binding.
 */

/** Old PAT prefix — still accepted by the server for backward compat. */
const LEGACY_PAT_PREFIX = "pat-lw-";

/** Unified API key prefix — also used by legacy project keys. */
const API_KEY_PREFIX = "sk-lw-";

export interface LangWatchAuthHeadersInput {
  /** API key token. May be empty; in that case no auth headers are emitted. */
  apiKey: string;
  /**
   * Project identifier. Required for user-scoped API keys to resolve scope;
   * optional for legacy project keys (the token already encodes project identity).
   * Falls back to `LANGWATCH_PROJECT_ID` when omitted.
   */
  projectId?: string;
}

export type LangWatchAuthHeaders = Record<string, string>;

/**
 * Whether the credential is a user-scoped API key (as opposed to a legacy project key): a
 * `pat-lw-` prefix, or a `sk-lw-` prefix with an underscore in the body (the new format).
 */
export const isUserScopedApiKey = (token: string): boolean => {
  if (token.startsWith(LEGACY_PAT_PREFIX)) return true;
  if (token.startsWith(API_KEY_PREFIX)) {
    const body = token.slice(API_KEY_PREFIX.length);
    return body.includes("_");
  }
  return false;
};

/** @deprecated Use `isUserScopedApiKey` instead. Kept for backward compat. */
export const isPersonalAccessToken = isUserScopedApiKey;

/**
 * Builds the HTTP headers required to authenticate against the LangWatch
 * API using either a legacy project key or a user-scoped API key.
 */
export const buildAuthHeaders = ({
  apiKey,
  projectId,
}: LangWatchAuthHeadersInput): LangWatchAuthHeaders => {
  if (!apiKey) return {};

  const resolvedProjectId = projectId ?? process.env.LANGWATCH_PROJECT_ID ?? undefined;

  if (isUserScopedApiKey(apiKey)) {
    if (resolvedProjectId) {
      // Basic Auth is the canonical carrier — the server extracts both
      // the project and the token from one header.
      const encoded = Buffer.from(`${resolvedProjectId}:${apiKey}`, "utf-8").toString("base64");
      return { authorization: `Basic ${encoded}` };
    }

    // API key without a projectId: use Bearer and let the server reject
    // unresolvable requests.
    return {
      authorization: `Bearer ${apiKey}`,
      "x-auth-token": apiKey,
    };
  }

  // Legacy sk-lw-* project key: preserve the dual-header shape.
  return {
    authorization: `Bearer ${apiKey}`,
    "x-auth-token": apiKey,
  };
};
