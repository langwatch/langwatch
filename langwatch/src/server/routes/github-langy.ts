/**
 * Hono routes for the Langy GitHub App INSTALLATION flow (issue #4747).
 *
 * Surfaces:
 *   GET  /api/github-langy/install  — start: session-gated redirect to
 *        github.com/apps/<slug>/installations/new with a signed state.
 *   GET  /api/github-langy/setup    — GitHub's post-install redirect. Verify the
 *        signed state, record the installation against the organization it was
 *        bound to, then postMessage the opener (popup) or 302 back (redirect).
 *   POST /api/github-langy/webhook  — GitHub installation webhooks. Verifies the
 *        X-Hub-Signature-256 HMAC and keeps the installation row + repo
 *        selection fresh (created/deleted/suspend/unsuspend, repositories
 *        added/removed). Idempotent.
 *
 * There is no per-user OAuth: an installation IS the access boundary, PRs are
 * bot-authored, and tokens are minted on demand from the App private key. The
 * public surfaces are protocol-mandated (GitHub's Setup URL + webhook delivery)
 * — every sensitive read is guarded by the signed state or the HMAC.
 *
 * The route is just HTTP plumbing. DB writes + GitHub HTTP live in
 * app-layer/langy/langy-github-installations.service.ts.
 *
 * Spec: specs/langy/langy-github-install.feature.
 */

import { createLogger } from "@langwatch/observability";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "~/env.mjs";
import {
  createServiceApp,
  handlerManagedAuth,
  publicEndpoint,
} from "~/server/api/security";
import { getApp } from "~/server/app-layer";
import { hasLangyAccess } from "~/server/app-layer/langy/langyAccessGate";
import { auditLog } from "~/server/auditLog";
import { getServerAuthSession } from "~/server/auth";
import {
  consumeGithubInstallNonce,
  registerGithubInstallNonce,
} from "~/server/app-layer/langy/githubOauthNonce";
import {
  popupErrorHtml,
  popupResponseHtml,
} from "~/server/app-layer/langy/githubOauthPopupHtml";
import {
  type GithubOauthStatePayload,
  STATE_TTL_MS,
  signGithubOauthState,
  verifyGithubOauthState,
} from "~/server/app-layer/langy/githubOauthState";

import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:github-langy");

// /setup is GitHub's Setup URL — a protocol-mandated public redirect target.
// All sensitive state is signed and bound to the session that started the flow.
const SETUP_PUBLIC_REASON =
  "GitHub App Setup URL — protocol-mandated public endpoint; all sensitive " +
  "state is HMAC-signed and bound to the session that started the flow.";

// /webhook is GitHub's webhook delivery target — public by protocol, verified
// in-handler by the X-Hub-Signature-256 HMAC against the shared webhook secret.
const WEBHOOK_PUBLIC_REASON =
  "GitHub App webhook delivery URL — protocol-mandated public endpoint; " +
  "every payload is verified in-handler by its X-Hub-Signature-256 HMAC.";

// /install is session-gated in-handler: it requires a logged-in user and an
// org-membership check before signing state and redirecting to github.com.
const INSTALL_HANDLER_AUTH_REASON =
  "Install-start endpoint: requires a valid application session (checked " +
  "in-handler via getServerAuthSession) plus an org-membership check before " +
  "any redirect to GitHub. State token is HMAC-signed and bound to the session.";

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
function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/settings/integrations#github";
  if (!raw) return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\r\n\t\0]/.test(raw)) return fallback;
  return raw;
}

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

// The App must have a private key (to mint tokens) + id (JWT issuer) + slug
// (the install deep-link target) for the install flow to be usable.
function installConfigured(): boolean {
  return Boolean(
    env.GITHUB_LANGY_PRIVATE_KEY &&
      env.GITHUB_LANGY_APP_ID &&
      env.GITHUB_LANGY_APP_SLUG,
  );
}

function withGithubError(returnTo: string, message: string): string {
  const url = new URL(returnTo, "http://relative.invalid");
  url.searchParams.set("githubError", message);
  return `${url.pathname}${url.search}${url.hash}`;
}

const POPUP_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-ancestors 'none'";

function popupHtml(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  body: string,
  status: number,
): Response {
  c.header("Content-Security-Policy", POPUP_CSP);
  c.header("X-Frame-Options", "DENY");
  return c.html(body, status);
}

// Render the setup error path consistently across popup and redirect modes.
function setupError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: any,
  state: GithubOauthStatePayload | null,
  errorMessage: string,
  status: number,
): Response {
  if (state && state.mode === "redirect") {
    const returnTo = safeReturnTo(state.returnTo);
    return c.redirect(withGithubError(returnTo, errorMessage), 302);
  }
  return popupHtml(c, popupErrorHtml(errorMessage), status);
}

function publicGithubErrorMessage(): string {
  return "GitHub installation failed. Please try again.";
}

secured
  .access(handlerManagedAuth(INSTALL_HANDLER_AUTH_REASON))
  .get("/github-langy/install", async (c) => {
    if (!installConfigured()) {
      return c.json(
        { error: "The GitHub integration is not available on this instance." },
        { status: 503 },
      );
    }
    const session = await getServerAuthSession({
      req: c.req.raw as NextRequestShim,
    });
    if (!session?.user) {
      return c.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Same authoritative gate as Langy's tRPC surface so the GitHub install
    // cannot become a rollout bypass.
    if (!(await hasLangyAccess({ user: session.user }))) {
      return c.json(
        { error: "The GitHub integration is not enabled for this account." },
        { status: 404 },
      );
    }
    const organizationId = c.req.query("organizationId") ?? "";
    if (!organizationId) {
      return c.json(
        { error: "organizationId query param is required" },
        { status: 400 },
      );
    }
    // Cross-tenant guard: the user must be a member of the org they install for.
    if (
      !(await getApp().langy.githubInstallations.isOrganizationMember({
        userId: session.user.id,
        organizationId,
      }))
    ) {
      return c.json(
        { error: "Not a member of this organization." },
        { status: 403 },
      );
    }

    const mode = c.req.query("mode") === "popup" ? "popup" : "redirect";
    const returnTo = safeReturnTo(c.req.query("return"));
    const nonce = randomBytes(16).toString("base64url");
    const nonceRegistered = await registerGithubInstallNonce(
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

    // GitHub redirects back to the App's configured Setup URL after install; the
    // signed `state` round-trips so /setup can bind the installation to the org.
    const url = new URL(
      `https://github.com/apps/${encodeURIComponent(
        env.GITHUB_LANGY_APP_SLUG!,
      )}/installations/new`,
    );
    url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

secured
  .access(publicEndpoint(SETUP_PUBLIC_REASON))
  .get("/github-langy/setup", async (c) => {
    const state = verifyState(c.req.query("state") ?? null);
    const installationId = c.req.query("installation_id");
    if (!state || !installationId) {
      return setupError(c, state, "Invalid state or missing installation", 400);
    }

    // Re-bind the session to the state's user.
    const session = await getServerAuthSession({
      req: c.req.raw as NextRequestShim,
    });
    if (!session?.user || session.user.id !== state.userId) {
      return setupError(c, state, "Session changed mid-flow", 401);
    }

    // Burn the single-use nonce (skips when Redis was down at /install).
    if (state.nonceRegistered) {
      const consumed = await consumeGithubInstallNonce(state.nonce);
      if (consumed === false) {
        return setupError(c, state, "Installation link already used", 401);
      }
    }

    // Re-check tenant membership (defense in depth against a stale state).
    if (
      !(await getApp().langy.githubInstallations.isOrganizationMember({
        userId: state.userId,
        organizationId: state.organizationId,
      }))
    ) {
      return setupError(c, state, "Not a member of this organization", 403);
    }

    const returnTo = safeReturnTo(state.returnTo);

    let accountLogin: string;
    try {
      ({ accountLogin } =
        await getApp().langy.githubInstallations.recordInstallation({
          installationId,
          organizationId: state.organizationId,
        }));
    } catch (err) {
      logger.warn({ err }, "github installation record failed");
      const publicMsg = publicGithubErrorMessage();
      return state.mode === "popup"
        ? popupHtml(c, popupErrorHtml(publicMsg), 502)
        : c.redirect(withGithubError(returnTo, publicMsg), 302);
    }

    try {
      await auditLog({
        userId: state.userId,
        organizationId: state.organizationId,
        action: "langy.github.install",
        args: { installationId, accountLogin },
      });
    } catch (err) {
      // The installation is already recorded — honour the success over audit
      // completeness (operator-visible via this logger).
      logger.warn(
        { err, organizationId: state.organizationId },
        "audit log write failed after github install — installation persisted",
      );
    }

    if (state.mode === "popup") {
      return popupHtml(c, popupResponseHtml(accountLogin), 200);
    }
    return c.redirect(returnTo, 302);
  });

// GitHub webhook events: installation created/deleted/suspend/unsuspend and
// installation_repositories added/removed. Verified by HMAC; idempotent.
type WebhookAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "added"
  | "removed";

function verifyWebhookSignature(
  rawBody: string,
  header: string | undefined,
): boolean {
  const secret = env.GITHUB_LANGY_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

secured
  .access(publicEndpoint(WEBHOOK_PUBLIC_REASON))
  .post("/github-langy/webhook", async (c) => {
    if (!env.GITHUB_LANGY_WEBHOOK_SECRET) {
      return c.json({ error: "Webhook not configured" }, { status: 404 });
    }
    // Read the RAW body — the HMAC is over the exact bytes GitHub sent.
    const rawBody = await c.req.text();
    if (!verifyWebhookSignature(rawBody, c.req.header("x-hub-signature-256"))) {
      return c.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: {
      action?: string;
      installation?: { id?: number };
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const eventType = c.req.header("x-github-event");
    const action = payload.action as WebhookAction | undefined;
    const installationId =
      payload.installation?.id != null ? String(payload.installation.id) : null;

    if (
      (eventType !== "installation" &&
        eventType !== "installation_repositories") ||
      !installationId ||
      !action
    ) {
      // Unknown/unrelated event — ack so GitHub doesn't retry.
      return c.json({ received: true });
    }

    try {
      await getApp().langy.githubInstallations.handleWebhookEvent({
        action,
        installationId,
      });
    } catch (err) {
      logger.warn(
        { err, action, installationId },
        "github webhook handling failed",
      );
      // Still ack — retries won't help a persistent handling error, and the
      // next event (or the setup callback) reconciles.
    }
    return c.json({ received: true });
  });

export const app = secured.hono;
