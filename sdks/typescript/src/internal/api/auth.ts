/**
 * Authentication header assembly for LangWatch SDK clients.
 *
 * Supports two token families that share the same HTTP surface:
 *
 *   1. `sk-lw-{random}` — legacy project API keys. The token itself carries
 *      the project identity, so we emit both `Authorization: Bearer <token>`
 *      and `X-Auth-Token: <token>` for backwards compatibility.
 *
 *   2. `sk-lw-{lookupId}_{secret}` or `pat-lw-{lookupId}_{secret}` — API
 *      keys (user-scoped). Must be paired with a `projectId` so the server
 *      can resolve the correct role binding. When a `projectId` is available
 *      we encode both into `Authorization: Basic base64(projectId:token)`.
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
 * Returns `true` when the supplied credential is a user-scoped API key
 * (as opposed to a legacy project key).
 *
 * Detection heuristics:
 *   - `pat-lw-*` → always a user-scoped key (old format)
 *   - `sk-lw-{chars}_{chars}` → user-scoped key (new format, has underscore)
 *   - `sk-lw-{chars}` (no underscore) → legacy project key
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

  const resolvedProjectId =
    projectId ?? process.env.LANGWATCH_PROJECT_ID ?? undefined;

  if (isUserScopedApiKey(apiKey)) {
    if (resolvedProjectId) {
      // Basic Auth is the canonical carrier — the server extracts both
      // the project and the token from one header.
      const encoded = Buffer.from(
        `${resolvedProjectId}:${apiKey}`,
        "utf-8",
      ).toString("base64");
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
