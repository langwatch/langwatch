/**
 * Hono routes for the organization's GitHub App installation flow.
 *
 * Surfaces:
 *   GET  /api/github/install: start, a session-gated redirect to
 *        github.com/apps/<slug>/installations/new with a signed state.
 *   GET  /api/github/setup: GitHub's post-install redirect. Verify the
 *        signed state, record the installation against the organization it was
 *        bound to, then postMessage the opener (popup) or 302 back (redirect).
 *   POST /api/github/webhook: GitHub installation webhooks. Verifies the
 *        X-Hub-Signature-256 HMAC and keeps the installation row + repo
 *        selection fresh (created/deleted/suspend/unsuspend, repositories
 *        added/removed). Idempotent.
 *
 * There is no per-user OAuth: an installation IS the access boundary, PRs are
 * bot-authored, and tokens are minted on demand from the App private key. The
 * public surfaces are protocol-mandated (GitHub's Setup URL + webhook delivery),
 * every sensitive read is guarded by the signed state or the HMAC.
 *
 * The route is just HTTP plumbing. DB writes + GitHub HTTP live in
 * app-layer/github/github-installations.service.ts.
 *
 * Spec: specs/integrations/github-connection.feature.
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { createLogger } from "@langwatch/observability";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { env } from "~/env.mjs";
import { hasOrganizationPermission } from "~/server/api/rbac";
import {
  createServiceApp,
  handlerManagedAuth,
  publicEndpoint,
} from "~/server/api/security";
import { getApp } from "~/server/app-layer";
import { GithubInstallationConflictError } from "~/server/app-layer/github/github-installations.service";
import { getGithubAppConfig } from "~/server/app-layer/github/githubAppConfig";
import {
  consumeGithubInstallNonce,
  registerGithubInstallNonce,
} from "~/server/app-layer/github/githubInstallNonce";
import {
  popupErrorHtml,
  popupResponseHtml,
} from "~/server/app-layer/github/githubInstallPopupHtml";
import {
  type GithubInstallStatePayload,
  STATE_TTL_MS,
  signGithubInstallState,
  verifyGithubInstallState,
} from "~/server/app-layer/github/githubInstallState";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";

import type { NextRequestShim } from "./types";

const logger = createLogger("langwatch:api:github");

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

function signState(payload: GithubInstallStatePayload): string {
  return signGithubInstallState(payload, signingKey());
}

function verifyState(token: string | null): GithubInstallStatePayload | null {
  return verifyGithubInstallState(token, signingKey());
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
  state: GithubInstallStatePayload | null,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInstall(c: any): Promise<Response> {
  const config = getGithubAppConfig();
  if (!config.configured) {
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
  const organizationId = c.req.query("organizationId") ?? "";
  if (!organizationId) {
    return c.json(
      { error: "organizationId query param is required" },
      { status: 400 },
    );
  }
  // Cross-tenant guard FIRST: the user must be a member of the org they install
  // for, so a non-member's response never depends on anything about that org.
  if (
    !(await getApp().github.installations.isOrganizationMember({
      userId: session.user.id,
      organizationId,
    }))
  ) {
    return c.json(
      { error: "Not a member of this organization." },
      { status: 403 },
    );
  }
  // Connecting GitHub grants repository access to the whole organization, so it
  // takes organization management: the same permission the tRPC surface demands
  // for every write to the connection.
  if (
    !(await hasOrganizationPermission(
      { prisma, session },
      organizationId,
      "organization:manage",
    ))
  ) {
    return c.json({ error: "Forbidden" }, { status: 403 });
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
      config.appSlug,
    )}/installations/new`,
  );
  url.searchParams.set("state", state);
  return c.redirect(url.toString(), 302);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSetup(c: any): Promise<Response> {
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
    !(await getApp().github.installations.isOrganizationMember({
      userId: state.userId,
      organizationId: state.organizationId,
    }))
  ) {
    return setupError(c, state, "Not a member of this organization", 403);
  }

  // Re-check the connect permission too: the caller's role may have been
  // lowered between /install and GitHub's redirect back here, and recording
  // the installation is the write the permission exists to gate.
  if (
    !(await hasOrganizationPermission(
      { prisma, session },
      state.organizationId,
      "organization:manage",
    ))
  ) {
    return setupError(c, state, "Forbidden", 403);
  }

  const returnTo = safeReturnTo(state.returnTo);

  let accountLogin: string;
  try {
    ({ accountLogin } = await getApp().github.installations.recordInstallation({
      installationId,
      organizationId: state.organizationId,
    }));
  } catch (err) {
    // A cross-tenant takeover attempt (installation already owned by another
    // org) is a security event, not an ordinary failure: audit it against the
    // acting user/org so it is visible, but still return the generic message
    // so the caller learns nothing about whether the installation id exists.
    if (err instanceof GithubInstallationConflictError) {
      logger.warn(
        {
          installationId: err.installationId,
          attemptedOrganizationId: err.attemptedOrganizationId,
          userId: state.userId,
        },
        "blocked cross-tenant github installation rebind attempt",
      );
      try {
        await auditLog({
          userId: state.userId,
          organizationId: state.organizationId,
          action: "github.connection.install.rejected_cross_tenant",
          args: { installationId: err.installationId },
        });
      } catch (auditErr) {
        logger.warn(
          { err: auditErr },
          "audit log write failed after blocked rebind",
        );
      }
    } else {
      logger.warn({ err }, "github installation record failed");
    }
    const publicMsg = publicGithubErrorMessage();
    return state.mode === "popup"
      ? popupHtml(c, popupErrorHtml(publicMsg), 502)
      : c.redirect(withGithubError(returnTo, publicMsg), 302);
  }

  try {
    await auditLog({
      userId: state.userId,
      organizationId: state.organizationId,
      action: "github.connection.install",
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
}

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
  const secret = getGithubAppConfig().webhookSecret;
  if (!secret || !header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleWebhook(c: any): Promise<Response> {
  if (!getGithubAppConfig().webhookSecret) {
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
    await getApp().github.installations.handleWebhookEvent({
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
}

secured
  .access(
    handlerManagedAuth({
      reason: INSTALL_HANDLER_AUTH_REASON,
      permissions: ["organization:manage"],
      credential: "session",
    }),
  )
  .get("/github/install", handleInstall);

secured
  .access(publicEndpoint(SETUP_PUBLIC_REASON))
  .get("/github/setup", handleSetup);

secured
  .access(publicEndpoint(WEBHOOK_PUBLIC_REASON))
  .post("/github/webhook", handleWebhook);

// The GitHub App configuration on github.com points its Setup URL and its
// webhook delivery at the legacy paths, so both stay mounted on the same
// handlers until that configuration is flipped to the canonical paths above.
// Removing these two mounts is a tracked follow-up. /install needs no alias: it
// is ours to call, and every caller in this repo uses the canonical path.
secured
  .access(publicEndpoint(SETUP_PUBLIC_REASON))
  .get("/github-langy/setup", handleSetup);

secured
  .access(publicEndpoint(WEBHOOK_PUBLIC_REASON))
  .post("/github-langy/webhook", handleWebhook);

export const app = secured.hono;
