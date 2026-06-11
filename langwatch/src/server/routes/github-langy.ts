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
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

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

import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:github-langy");

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

// State carries (userId, organizationId, mode, return path, nonce) signed with
// CREDENTIALS_SECRET. Short TTL so a stolen state token can't be replayed
// later. Encoded as base64url to survive the URL.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const PUBLIC_REASON =
  "GitHub App OAuth redirect URI — protocol-mandated public endpoint; " +
  "all sensitive state is signed and bound to the session that started the flow.";

const secured = createServiceApp({ basePath: "/api" });

type StatePayload = {
  userId: string;
  organizationId: string;
  mode: "popup" | "redirect";
  returnTo: string;
  issuedAt: number;
  nonce: string;
};

function signingKey(): string {
  const secret = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("CREDENTIALS_SECRET (or NEXTAUTH_SECRET) must be set");
  }
  return secret;
}

function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", signingKey())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(token: string | null): StatePayload | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", signingKey())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    return null;
  }
  if (
    typeof payload?.userId !== "string" ||
    typeof payload?.organizationId !== "string" ||
    typeof payload?.issuedAt !== "number"
  ) {
    return null;
  }
  if (Date.now() - payload.issuedAt > STATE_TTL_MS) return null;
  return payload;
}

// Only allow internal relative paths as returnTo, to prevent open-redirects.
function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/settings/integrations#github";
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

function appConfigured() {
  return Boolean(
    env.GITHUB_LANGY_CLIENT_ID && env.GITHUB_LANGY_CLIENT_SECRET,
  );
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
    const mode = c.req.query("mode") === "popup" ? "popup" : "redirect";
    const returnTo = safeReturnTo(c.req.query("return"));

    const state = signState({
      userId: session.user.id,
      organizationId,
      mode,
      returnTo,
      issuedAt: Date.now(),
      nonce: randomBytes(16).toString("base64url"),
    });

    const origin =
      c.req.header("x-forwarded-host")
        ? `https://${c.req.header("x-forwarded-host")}`
        : new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/github-langy/callback`;

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

    const origin =
      c.req.header("x-forwarded-host")
        ? `https://${c.req.header("x-forwarded-host")}`
        : new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/github-langy/callback`;

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
        : c.redirect(
            `${state.returnTo}?githubError=${encodeURIComponent(msg)}`,
            302,
          );
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

    await auditLog({
      userId: state.userId,
      organizationId: state.organizationId,
      action: "langy.github.connect",
      args: { githubLogin: user.login },
    });

    if (state.mode === "popup") {
      return c.html(popupResponseHtml(user.login), 200);
    }
    return c.redirect(state.returnTo, 302);
  });

export const app = secured.hono;
