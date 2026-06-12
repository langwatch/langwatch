/**
 * GitHub OAuth HTTP client for the Langy GitHub App flow.
 *
 *   exchangeCode    — POST /login/oauth/access_token
 *   fetchGithubUser — GET  /user
 *
 * Lives outside the Hono route so the route module is just HTTP plumbing.
 * The refresh-token path lives in langyGithubToken.ts (different concurrency
 * model — single-use rotation needs a Redis lock there). Issue #4747.
 */
import { env } from "~/env.mjs";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

export type GithubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type GithubUser = {
  id: number;
  login: string;
};

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<GithubTokenResponse> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_LANGY_CLIENT_ID!,
      client_secret: env.GITHUB_LANGY_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = (await res.json()) as GithubTokenResponse;
  if (!res.ok || body.error || !body.access_token || !body.refresh_token) {
    throw new Error(
      `GitHub token exchange failed: ${body.error ?? res.statusText}`,
    );
  }
  return body;
}

export async function fetchGithubUser(
  accessToken: string,
): Promise<GithubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "langwatch-langy",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user failed: ${res.status}`);
  }
  return (await res.json()) as GithubUser;
}
