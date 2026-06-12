/**
 * Hono routes for the Langy GitHub App OAuth (per-user) flow.
 *
 * Surfaces:
 *   GET /api/github-langy/connect    — start: redirect to github.com/login/oauth/authorize
 *   GET /api/github-langy/callback   — finish: exchange code, upsert UserGitHubCredential,
 *                                      either postMessage to the opener (popup mode) or 302
 *                                      back to settings (redirect mode).
 *
 * Why a public REST endpoint at all: OAuth redirect_uri is part of the protocol
 * and cannot live behind tRPC. The two surfaces here are the only public bits;
 * everything else (read connection / disconnect) is tRPC.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { randomBytes } from "crypto";

import {
  createServiceApp,
  publicEndpoint,
} from "~/server/api/security";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { auditLog } from "~/server/auditLog";
import { encrypt } from "~/utils/encryption";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";
import {
  signGithubOauthState,
  STATE_TTL_MS,
  verifyGithubOauthState,
  type GithubOauthStatePayload,
} from "~/server/services/langy/githubOauthState";
import {
  clearGithubTokenCache,
  consumeGithubOauthNonce,
  registerGithubOauthNonce,
} from "~/server/services/langy/langyGithubToken";

import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:github-langy");

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

const PUBLIC_REASON =
  "GitHub App OAuth redirect URI — protocol-mandated public endpoint; " +
  "all sensitive state is signed and bound to the session that started the flow.";

const secured = createServiceApp({ basePath: "/api" });

function signingKey(): string {
  const secret = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be set");
  }
  return secret;
}

function signState(payload: GithubOauthStatePayload): string {
  return signGithubOauthState(payload, signingKey());
}

function verifyState(token: string | null): GithubOauthStatePayload | null {
  return verifyGithubOauthState(token, signingKey());
}

// Only allow internal relative paths as returnTo, to prevent open-redirects.
// We block:
//  - schemes (http://, javascript:, data:) — they don't start with `/`
//  - protocol-relative (`//evil.com`) — second-char `/`
//  - backslash-prefixed (`/\evil.com`) — some browsers normalize `\` → `/`
//  - CRLF (response-splitting if echoed into a header)
function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/settings/integrations#github";
  if (!raw) return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n\t\0]/.test(raw)) return fallback;
  return raw;
}

// Origin used to construct the GitHub `redirect_uri`. Must match the App's
// registered Callback URL EXACTLY, so derive it from server-side env, NOT a
// client-controllable header. Falling back to the request URL only when env
// isn't set keeps local dev usable.
function appOrigin(reqUrl: string): string {
  const fromEnv = env.NEXTAUTH_URL;
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      // misconfigured NEXTAUTH_URL — fall through to request-derived
    }
  }
  return new URL(reqUrl).origin;
}

function appConfigured() {
  return Boolean(
    env.GITHUB_LANGY_CLIENT_ID && env.GITHUB_LANGY_CLIENT_SECRET,
  );
}

// encrypt() (utils/encryption) requires a 32-byte hex CREDENTIALS_SECRET.
// signingKey() above tolerates any string, so without this check a non-hex
// secret lets the whole OAuth dance succeed at GitHub and then 500 at the
// final upsert. Fail fast at /connect instead.
function encryptionConfigured(): boolean {
  const secret = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  return typeof secret === "string" && /^[0-9a-fA-F]{64}$/.test(secret);
}

// Append ?githubError=... while preserving a fragment in returnTo (the
// default is `/settings/integrations#github` — naive `${returnTo}?x=y`
// would bury the query inside the fragment where nothing can read it).
function withGithubError(returnTo: string, message: string): string {
  const url = new URL(returnTo, "http://relative.invalid");
  url.searchParams.set("githubError", message);
  return `${url.pathname}${url.search}${url.hash}`;
}

secured
  .access(publicEndpoint(PUBLIC_REASON))
  .get("/github-langy/connect", async (c) => {
    if (!appConfigured()) {
      return c.json(
        { error: "GitHub integration is not configured on this instance." },
        { status: 503 },
      );
    }
    if (!encryptionConfigured()) {
      return c.json(
        {
          error:
            "CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be a 32-byte hex " +
            "string to store GitHub credentials on this instance.",
        },
        { status: 503 },
      );
    }
    const session = await getServerAuthSession({
      req: c.req.raw as NextRequestShim,
    });
    if (!session?.user) {
      return c.json({ error: "Not authenticated" }, { status: 401 });
    }
    const organizationId = c.req.query("organizationId") ?? "";
    if (!organizationId) {
      return c.json(
        { error: "organizationId query param is required" },
        { status: 400 },
      );
    }

    // Cross-tenant guard: the user must be a member of the org they're
    // connecting GitHub for. Without this, the callback would upsert a
    // UserGitHubCredential under (userId, OTHER-ORG) — which the partition
    // guard accepts (single org per row) but is still a tenant-boundary
    // violation: the row appears in OTHER-ORG's footprint, and the audit log
    // says "user X connected GitHub in org Y" against an org X is not in.
    const membership = await prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: session.user.id,
          organizationId,
        },
      },
    });
    if (!membership) {
      return c.json(
        { error: "Not a member of this organization." },
        { status: 403 },
      );
    }

    const mode = c.req.query("mode") === "popup" ? "popup" : "redirect";
    const returnTo = safeReturnTo(c.req.query("return"));
    const nonce = randomBytes(16).toString("base64url");

    // Register the nonce in Redis with the same TTL as the signed state. The
    // callback consumes it once and rejects replays. When Redis isn't wired
    // the check skips silently — the signature + session-rebind still defend.
    // Whether registration succeeded rides in the SIGNED state, so a Redis
    // flap between connect (down — nonce never stored) and callback (up —
    // "missing" looks like a replay) can't 401 a legitimate first use.
    const nonceRegistered = await registerGithubOauthNonce(
      nonce,
      Math.ceil(STATE_TTL_MS / 1000),
    );

    const state = signState({
      userId: session.user.id,
      organizationId,
      mode,
      returnTo,
      issuedAt: Date.now(),
      nonce,
      nonceRegistered,
    });

    const redirectUri = `${appOrigin(c.req.url)}/api/github-langy/callback`;

    const url = new URL(GITHUB_AUTHORIZE_URL);
    url.searchParams.set("client_id", env.GITHUB_LANGY_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    // Scopes are governed by the App's installation permissions; this is a hint
    // for the consent screen. Leave blank to use App defaults.
    return c.redirect(url.toString(), 302);
  });

type GithubTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GithubUser = {
  id: number;
  login: string;
};

async function exchangeCode(code: string, redirectUri: string) {
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

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
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

function popupResponseHtml(login: string) {
  const safe = login.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body style="font:14px system-ui;color:#444;padding:24px">
<p>Connected as <strong>@${safe}</strong>. You can close this window.</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "langy-github-connected", login: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
  window.close();
</script>
</body></html>`;
}

function popupErrorHtml(message: string) {
  const safe = message.replace(/[<>&]/g, "");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connection failed</title></head>
<body style="font:14px system-ui;color:#a00;padding:24px">
<p>GitHub connection failed: ${safe}</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "langy-github-error", message: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
</script>
</body></html>`;
}

secured
  .access(publicEndpoint(PUBLIC_REASON))
  .get("/github-langy/callback", async (c) => {
    const code = c.req.query("code");
    const state = verifyState(c.req.query("state") ?? null);
    if (!code || !state) {
      return c.html(popupErrorHtml("Invalid state or missing code"), 400);
    }

    // Re-check the session matches the state's user. Defends against the case
    // where the state cookie outlives the session or another user picked up
    // the popup mid-flight.
    const session = await getServerAuthSession({
      req: c.req.raw as NextRequestShim,
    });
    if (!session?.user || session.user.id !== state.userId) {
      return c.html(popupErrorHtml("Session changed mid-flow"), 401);
    }

    // Burn the nonce. If the nonce was registered at /connect and is missing
    // now, the state was already used (replay) — reject. If it was never
    // registered (Redis down at /connect — the signed flag says so) or Redis
    // is down now (null), fall through to the signature + session defenses.
    if (state.nonceRegistered) {
      const nonceConsumed = await consumeGithubOauthNonce(state.nonce);
      if (nonceConsumed === false) {
        return c.html(popupErrorHtml("State already used"), 401);
      }
    }

    // Re-check tenant membership on the callback too. Same threat as in
    // /connect — defense in depth in case a stale state outlives a
    // membership change between connect and callback.
    const membership = await prisma.organizationUser.findUnique({
      where: {
        userId_organizationId: {
          userId: state.userId,
          organizationId: state.organizationId,
        },
      },
    });
    if (!membership) {
      return c.html(popupErrorHtml("Not a member of this organization"), 403);
    }

    const redirectUri = `${appOrigin(c.req.url)}/api/github-langy/callback`;

    // The state is signed, but re-apply the returnTo allowlist anyway —
    // defense in depth against a future signer that forgets to sanitize.
    const returnTo = safeReturnTo(state.returnTo);

    let token: GithubTokenResponse;
    let user: GithubUser;
    try {
      token = await exchangeCode(code, redirectUri);
      user = await fetchGithubUser(token.access_token!);
    } catch (err) {
      logger.warn({ err }, "github callback exchange failed");
      const msg = err instanceof Error ? err.message : String(err);
      return state.mode === "popup"
        ? c.html(popupErrorHtml(msg), 502)
        : c.redirect(withGithubError(returnTo, msg), 302);
    }

    await prisma.userGitHubCredential.upsert({
      where: {
        userId_organizationId: {
          userId: state.userId,
          organizationId: state.organizationId,
        },
      },
      create: {
        userId: state.userId,
        organizationId: state.organizationId,
        githubLogin: user.login,
        githubUserId: String(user.id),
        encryptedRefreshToken: encrypt(token.refresh_token!),
        scopes: token.scope ?? null,
      },
      update: {
        githubLogin: user.login,
        githubUserId: String(user.id),
        encryptedRefreshToken: encrypt(token.refresh_token!),
        scopes: token.scope ?? null,
      },
    });

    // A reconnect may follow a disconnect that revoked the previous grant;
    // the mint cache could still hold a token from that dead grant. Clear it
    // so the next chat mints from the refresh token we just stored.
    await clearGithubTokenCache({
      userId: state.userId,
      organizationId: state.organizationId,
    });

    await auditLog({
      userId: state.userId,
      organizationId: state.organizationId,
      action: "langy.github.connect",
      args: { githubLogin: user.login },
    });

    if (state.mode === "popup") {
      return c.html(popupResponseHtml(user.login), 200);
    }
    return c.redirect(returnTo, 302);
  });

export const app = secured.hono;
