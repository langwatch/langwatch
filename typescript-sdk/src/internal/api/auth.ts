/**
 * Authentication header assembly for LangWatch SDK clients.
 *
 * Supports two token families that share the same HTTP surface:
 *
 *   1. `sk-lw-*` — legacy project API keys. The token itself carries the
 *      project identity, so we emit both `Authorization: Bearer <token>`
 *      and `X-Auth-Token: <token>` for backwards compatibility with older
 *      endpoints that only look at the legacy header.
 *
 *   2. `pat-lw-*` — Personal Access Tokens. PATs are user-owned and must
 *      be paired with a `projectId` so the server can resolve the correct
 *      role binding. When a `projectId` is available we encode both into
 *      a single `Authorization: Basic base64(projectId:token)` header —
 *      this is the canonical PAT carrier understood by every migrated
 *      route. Without a `projectId` we fall back to Bearer + an
 *      `X-Project-Id` header if the caller supplies one.
 */

/** Prefix marking a Personal Access Token. */
const PAT_PREFIX = "pat-lw-";

export interface LangWatchAuthHeadersInput {
  /** API key or PAT. May be empty; in that case no auth headers are emitted. */
  apiKey: string;
  /**
   * Project identifier. Required for PATs to resolve scope; optional for
   * legacy `sk-lw-*` keys (the token already encodes project identity).
   * Falls back to `LANGWATCH_PROJECT_ID` when omitted.
   */
  projectId?: string;
}

export type LangWatchAuthHeaders = Record<string, string>;

/**
 * Returns `true` when the supplied credential is a Personal Access Token.
 * Safe to call with empty or malformed strings.
 */
export const isPersonalAccessToken = (token: string): boolean =>
  token.startsWith(PAT_PREFIX);

/**
 * Builds the HTTP headers required to authenticate against the LangWatch
 * API using either a legacy project key or a Personal Access Token.
 */
export const buildAuthHeaders = ({
  apiKey,
  projectId,
}: LangWatchAuthHeadersInput): LangWatchAuthHeaders => {
  if (!apiKey) return {};

  const resolvedProjectId =
    projectId ?? process.env.LANGWATCH_PROJECT_ID ?? undefined;

  if (isPersonalAccessToken(apiKey)) {
    if (resolvedProjectId) {
      // Basic Auth is the canonical PAT carrier — the server extracts both
      // the project and the token from one header.
      const encoded = Buffer.from(
        `${resolvedProjectId}:${apiKey}`,
        "utf-8",
      ).toString("base64");
      return { authorization: `Basic ${encoded}` };
    }

    // PAT without a projectId: use Bearer and let the server reject
    // unresolvable requests. We still send `x-auth-token` so endpoints
    // that haven't migrated to the unified middleware surface a
    // consistent 401 rather than a silent mismatch.
    return {
      authorization: `Bearer ${apiKey}`,
      "x-auth-token": apiKey,
    };
  }

  // Legacy sk-lw-* key: preserve the dual-header shape so callers that
  // read either header continue to work.
  return {
    authorization: `Bearer ${apiKey}`,
    "x-auth-token": apiKey,
  };
};
