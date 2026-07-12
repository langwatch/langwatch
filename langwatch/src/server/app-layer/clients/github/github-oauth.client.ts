/**
 * GitHub App OAuth client (per-user, user-to-server) for Langy.
 *
 * Owns everything that is a GitHub concern: the HTTP calls to the OAuth token
 * endpoint and `/user`, their timeouts, response parsing, and the
 * grant-dead-vs-transient classification GitHub encodes in its (often HTTP-200)
 * error responses. It owns NOTHING about how we store or serialise the rotated
 * refresh token — the single-use rotation lock, the access-token cache, and the
 * encrypted `UserGitHubCredential` row all live in the credentials service and
 * its repository. Issue #4747.
 */

/** A minted set of GitHub user-to-server tokens. */
export interface GithubOAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (~8h for GitHub App user tokens). */
  expiresIn: number;
  /** The granted scope string, informational (governed by the App install). */
  scope?: string;
}

export interface GithubUser {
  id: number;
  login: string;
}

/**
 * The outcome of a single-use refresh-token rotation.
 *
 * `grantDead` distinguishes "this credential will never work again" (bad refresh
 * token / revoked App / user revoked — delete the row, surface the connect card)
 * from a transient failure (GitHub 5xx / rate limit / network — keep the row,
 * the user retries). GitHub reports grant errors as a JSON `error` field, often
 * with HTTP 200; anything 5xx, or a response with no error field, is transient.
 */
export type GithubRefreshResult =
  | { ok: true; tokens: GithubOAuthTokens }
  | { ok: false; grantDead: boolean };

export interface GithubOAuthClient {
  /** Exchange an authorization code for the initial token set. Throws on failure. */
  exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<GithubOAuthTokens>;

  /** Rotate a single-use refresh token into a fresh token set. Never throws. */
  refreshToken(refreshToken: string): Promise<GithubRefreshResult>;

  /** Look up the authenticated user for `{ id, login }`. Throws on failure. */
  fetchUser(accessToken: string): Promise<GithubUser>;

  /**
   * Best-effort revoke the App's grant for the user owning `accessToken` (the
   * `DELETE /applications/{client_id}/grant` endpoint, authed with the App's
   * basic credentials). Never throws — revocation is best-effort and the local
   * row delete is the source of truth.
   */
  revokeGrant(accessToken: string): Promise<void>;
}

/**
 * No-op client for instances where the Langy GitHub App is not configured
 * (`GITHUB_LANGY_CLIENT_ID` / `_SECRET` unset). Exchange/fetch throw — they are
 * only reached from the OAuth routes, which are themselves feature-gated — while
 * `refreshToken` reports a dead grant so the credentials service cleanly returns
 * "no GitHub token" without a special case.
 */
export class NullGithubOAuthClient implements GithubOAuthClient {
  async exchangeCode(): Promise<GithubOAuthTokens> {
    throw new Error("Langy GitHub App is not configured on this instance.");
  }

  async refreshToken(): Promise<GithubRefreshResult> {
    return { ok: false, grantDead: true };
  }

  async fetchUser(): Promise<GithubUser> {
    throw new Error("Langy GitHub App is not configured on this instance.");
  }

  async revokeGrant(): Promise<void> {}
}
