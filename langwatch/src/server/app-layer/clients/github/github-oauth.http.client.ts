import { createLogger } from "~/utils/logger/server";
import {
  type GithubOAuthClient,
  type GithubOAuthTokens,
  type GithubRefreshResult,
  type GithubUser,
} from "./github-oauth.client";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/**
 * Bound the upstream wait — a hung GitHub call would otherwise block the caller
 * until the runtime tears the socket down (Linux defaults: tens of minutes).
 * The refresh timeout is additionally kept under the credentials service's
 * single-use rotation lock TTL (10s) so a slow refresh can't outlive the lock
 * and let a second caller race the rotation.
 */
const DEFAULT_EXCHANGE_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 8_000;

interface GithubTokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class GithubOAuthHttpClient implements GithubOAuthClient {
  private readonly logger = createLogger("langwatch:langy:github-oauth-client");

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly exchangeTimeoutMs: number = DEFAULT_EXCHANGE_TIMEOUT_MS,
    private readonly refreshTimeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS,
  ) {}

  async exchangeCode({
    code,
    redirectUri,
  }: {
    code: string;
    redirectUri: string;
  }): Promise<GithubOAuthTokens> {
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(this.exchangeTimeoutMs),
    });
    const body = (await res.json()) as GithubTokenBody;
    // `expires_in` is NOT required at exchange (it is only meaningful on the
    // refresh path); a missing value defaults to 0 so the connect flow succeeds.
    if (!res.ok || body.error || !body.access_token || !body.refresh_token) {
      throw new Error(
        `GitHub token exchange failed: ${body.error ?? res.statusText}`,
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in ?? 0,
      scope: body.scope,
    };
  }

  async refreshToken(refreshToken: string): Promise<GithubRefreshResult> {
    let res: Response;
    let body: GithubTokenBody;
    try {
      res = await fetch(GITHUB_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(this.refreshTimeoutMs),
      });
      body = (await res.json()) as GithubTokenBody;
    } catch (err) {
      this.logger.warn({ err }, "refresh failed (network/timeout) — keeping row");
      return { ok: false, grantDead: false };
    }
    if (
      res.ok &&
      !body.error &&
      body.access_token &&
      body.refresh_token &&
      typeof body.expires_in === "number"
    ) {
      return {
        ok: true,
        tokens: {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresIn: body.expires_in,
          scope: body.scope,
        },
      };
    }
    // GitHub's OAuth token endpoint reports grant errors as a JSON `error` field
    // (often with HTTP 200). Anything 5xx — or a response with no error field at
    // all — is treated as transient.
    const grantDead = res.status < 500 && Boolean(body.error);
    this.logger.warn(
      { status: res.status, error: body.error, grantDead },
      "refresh failed",
    );
    return { ok: false, grantDead };
  }

  async fetchUser(accessToken: string): Promise<GithubUser> {
    const res = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "langwatch-langy",
      },
      signal: AbortSignal.timeout(this.exchangeTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`GitHub /user failed: ${res.status}`);
    }
    return (await res.json()) as GithubUser;
  }

  async revokeGrant(accessToken: string): Promise<void> {
    try {
      const basic = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString("base64");
      await fetch(
        `https://api.github.com/applications/${encodeURIComponent(this.clientId)}/grant`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
            "User-Agent": "langwatch-langy",
          },
          body: JSON.stringify({ access_token: accessToken }),
          // Cap the upstream wait — a hung GitHub endpoint would otherwise block
          // the disconnect call. Revocation is best-effort (we log on failure).
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch (err) {
      this.logger.warn({ err }, "github grant revocation best-effort failed");
    }
  }
}
