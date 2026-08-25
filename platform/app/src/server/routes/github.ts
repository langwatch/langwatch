/**
 * Hono routes for the organization's GitHub App installation flow.
 *
 * Surfaces:
 *   GET  /api/github/install: start, a session-gated redirect to the App's
 *        public installation page on the configured GitHub host, with a signed
 *        state.
 *   GET  /api/github/setup: GitHub's post-install redirect. Verify the
 *        signed state, record the installation against the organization it was
 *        bound to, then postMessage the opener (popup) or 302 back (redirect).
 *   POST /api/github/webhook: GitHub webhooks. Verifies the
 *        X-Hub-Signature-256 HMAC, then keeps the installation row + repo
 *        selection fresh (created/deleted/suspend/unsuspend, repositories
 *        added/removed) and links a pull request to its head branch the moment
 *        `pull_request` says one exists. Idempotent.
 *
 * There is no per-user OAuth: an installation IS the access boundary, PRs are
 * bot-authored, and tokens are minted on demand from the App private key. The
 * public surfaces are protocol-mandated (GitHub's Setup URL + webhook delivery),
 * every sensitive read is guarded by the signed state or the HMAC.
 *
 * The route is just HTTP plumbing. DB writes + GitHub HTTP live behind the
 * composed GithubService.
 *
 * Spec: specs/integrations/github-connection.feature.
 */

import { auditLog } from "~/runtime/app/features/audit-log";
import { createLogger } from "@langwatch/observability";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Context } from "hono";
import { z } from "zod";
import type { GithubInstallStatePayload, GithubService } from "@langwatch/github-contract";
import { GithubInstallationConflictError } from "@langwatch/github-contract";
import {
  createServiceApp,
  handlerManagedAuth,
  publicEndpoint,
} from "~/server/api/security";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";

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
// org-membership check before signing state and redirecting to GitHub.
const INSTALL_HANDLER_AUTH_REASON =
  "Install-start endpoint: requires a valid application session (checked " +
  "in-handler via getServerAuthSession) plus an org-membership check before " +
  "any redirect to GitHub. State token is HMAC-signed and bound to the session.";

const secured = createServiceApp({ basePath: "/api" });

function signState(service: GithubService, payload: GithubInstallStatePayload): string {
  return service.signInstallState(payload);
}

function verifyState(
  service: GithubService,
  token: string | null,
): GithubInstallStatePayload | null {
  return service.tryVerifyInstallState(token);
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
  c: Context,
  body: string,
  status: number,
): Response {
  c.header("Content-Security-Policy", POPUP_CSP);
  c.header("X-Frame-Options", "DENY");
  return c.html(body, status);
}

// Render the setup error path consistently across popup and redirect modes.
function setupError({
  c,
  state,
  errorMessage,
  status,
}: {
  c: Context;
  state: GithubInstallStatePayload | null;
  errorMessage: string;
  status: number;
}): Response {
  if (state && state.mode === "redirect") {
    const returnTo = safeReturnTo(state.returnTo);
    return c.redirect(withGithubError(returnTo, errorMessage), 302);
  }
  return popupHtml(c, c.app.github.popupErrorHtml(errorMessage), status);
}

function publicGithubErrorMessage(): string {
  return "GitHub installation failed. Please try again.";
}

async function handleInstall(c: Context): Promise<Response> {
  const service: GithubService = c.app.github;
  const config = service.getAppConfig();
  if (!config.configured) {
    return c.json(
      { error: "The GitHub integration is not available on this instance." },
      { status: 503 },
    );
  }
  const session = await getServerAuthSession({
    req: c.req.raw,
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
    !(await service.isOrganizationMember({
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
    !(await probeOrganizationPermission(
      { session },
      organizationId,
      "organization:manage",
    ))
  ) {
    return c.json({ error: "Forbidden" }, { status: 403 });
  }

  const mode = c.req.query("mode") === "popup" ? "popup" : "redirect";
  const returnTo = safeReturnTo(c.req.query("return"));
  const nonce = randomBytes(16).toString("base64url");
  const nonceRegistered = await service.registerInstallNonce({
    nonce,
    ttlSec: Math.ceil(service.getInstallStateTtlMs() / 1000),
  });

  const state = signState(service, {
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
  const url = new URL(service.getAppInstallUrl());
  url.searchParams.set("state", state);
  return c.redirect(url.toString(), 302);
}

async function handleSetup(c: Context): Promise<Response> {
  const service: GithubService = c.app.github;
  const state = verifyState(service, c.req.query("state") ?? null);
  const installationId = c.req.query("installation_id");
  if (!state || !installationId) {
    return setupError({
      c,
      state,
      errorMessage: "Invalid state or missing installation",
      status: 400,
    });
  }

  const rejection = await rejectUnauthorizedSetup({ c, state });
  if (rejection) return rejection;

  const returnTo = safeReturnTo(state.returnTo);

  let accountLogin: string;
  try {
    ({ accountLogin } = await service.recordInstallation({
      installationId,
      organizationId: state.organizationId,
    }));
  } catch (err) {
    await reportInstallationFailure({ err, state });
    const publicMsg = publicGithubErrorMessage();
    return state.mode === "popup"
      ? popupHtml(c, service.popupErrorHtml(publicMsg), 502)
      : c.redirect(withGithubError(returnTo, publicMsg), 302);
  }

  await recordInstallAudit({ state, installationId, accountLogin });

  if (state.mode === "popup") {
    return popupHtml(c, service.popupResponseHtml(accountLogin), 200);
  }
  return c.redirect(returnTo, 302);
}

/**
 * Every re-check standing between /install and GitHub's redirect back here.
 * Returns the response that rejects the flow, or null to let it proceed.
 */
async function rejectUnauthorizedSetup({
  c,
  state,
}: {
  c: Context;
  state: GithubInstallStatePayload;
}): Promise<Response | null> {
  // Re-bind the session to the state's user.
  const session = await getServerAuthSession({
    req: c.req.raw,
  });
  if (!session?.user || session.user.id !== state.userId) {
    return setupError({
      c,
      state,
      errorMessage: "Session changed mid-flow",
      status: 401,
    });
  }

  // Burn the single-use nonce (skips when Redis was down at /install).
  if (state.nonceRegistered) {
    const consumed = await c.app.github.tryConsumeInstallNonce(state.nonce);
    if (consumed === false) {
      return setupError({
        c,
        state,
        errorMessage: "Installation link already used",
        status: 401,
      });
    }
  }

  // Re-check tenant membership (defense in depth against a stale state).
  if (
    !(await c.app.github.isOrganizationMember({
      userId: state.userId,
      organizationId: state.organizationId,
    }))
  ) {
    return setupError({
      c,
      state,
      errorMessage: "Not a member of this organization",
      status: 403,
    });
  }

  // Re-check the connect permission too: the caller's role may have been
  // lowered between /install and GitHub's redirect back here, and recording
  // the installation is the write the permission exists to gate.
  if (
    !(await probeOrganizationPermission(
      { session },
      state.organizationId,
      "organization:manage",
    ))
  ) {
    return setupError({ c, state, errorMessage: "Forbidden", status: 403 });
  }

  return null;
}

/**
 * Record why the installation could not be written.
 *
 * A cross-tenant takeover attempt (installation already owned by another org)
 * is a security event, not an ordinary failure: audit it against the acting
 * user/org so it is visible. The caller still returns the generic message, so
 * nothing leaks about whether the installation id exists.
 */
async function reportInstallationFailure({
  err,
  state,
}: {
  err: unknown;
  state: GithubInstallStatePayload;
}): Promise<void> {
  if (!(err instanceof GithubInstallationConflictError)) {
    logger.warn({ err }, "github installation record failed");
    return;
  }
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
}

/**
 * The installation is already recorded by the time this runs, so honour the
 * success over audit completeness; a failed write stays operator-visible
 * through this logger.
 */
async function recordInstallAudit({
  state,
  installationId,
  accountLogin,
}: {
  state: GithubInstallStatePayload;
  installationId: string;
  accountLogin: string;
}): Promise<void> {
  try {
    await auditLog({
      userId: state.userId,
      organizationId: state.organizationId,
      action: "github.connection.install",
      args: { installationId, accountLogin },
    });
  } catch (err) {
    logger.warn(
      { err, organizationId: state.organizationId },
      "audit log write failed after github install, installation persisted",
    );
  }
}

// GitHub webhook events: installation created/deleted/suspend/unsuspend and
// installation_repositories added/removed. Verified by HMAC; idempotent.
//
// A schema rather than a bare type, so an action GitHub adds later is REJECTED
// here and acked by the guard below, instead of being cast to this union and
// reaching a dispatcher that has no default case to catch it.
/** The envelope both installation events share, parsed before any field read. */
const installationEnvelopeSchema = z.object({
  action: z.unknown().optional(),
  installation: z.object({ id: z.number().optional() }).nullish(),
});

const webhookActionSchema = z.enum([
  "created",
  "deleted",
  "suspend",
  "unsuspend",
  "added",
  "removed",
]);

function verifyWebhookSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!secret || !header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A `pull_request` delivery: link the head branch to its pull request now,
 * rather than waiting for that branch's next scheduled recheck, which for a
 * branch that has been asked about a few times already is up to a day away.
 *
 * Acked whatever happens, like every other event here. A payload this instance
 * cannot act on is not something a GitHub retry fixes, and the periodic recheck
 * is the backstop under a delivery that fails or never arrives at all.
 */
async function applyPullRequestEvent({
  payload,
  deliveryId,
  service,
}: {
  payload: unknown;
  deliveryId: string | undefined;
  service: GithubService;
}): Promise<void> {
  const event = service.tryParsePullRequestEvent(payload);
  if (!event) {
    // The parser declines four different deliveries, and every one of them
    // still answers 200. Without this line a linkage outage looks from the
    // outside like an unbroken run of successful deliveries. The payload is
    // deliberately not logged: the delivery id is enough to find it in
    // GitHub's own redelivery view, and a raw body here would put customer
    // repository content in the logs.
    logger.info(
      { deliveryId },
      "github pull request delivery dropped before linkage",
    );
    return;
  }
  try {
    await service.applyPullRequestEvent(event);
  } catch (err) {
    logger.warn(
      { err, action: event.action, installationId: event.installationId },
      "github pull request webhook handling failed",
    );
  }
}

async function handleWebhook(c: Context): Promise<Response> {
  const config = c.app.github.getAppConfig();
  if (!config.webhookSecret) {
    return c.json({ error: "Webhook not configured" }, { status: 404 });
  }
  // Read the RAW body — the HMAC is over the exact bytes GitHub sent.
  const rawBody = await c.req.text();
  if (!verifyWebhookSignature(
    rawBody,
    c.req.header("x-hub-signature-256"),
    config.webhookSecret,
  )) {
    return c.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = c.req.header("x-github-event");

  if (eventType === "pull_request") {
    await applyPullRequestEvent({
      payload,
      deliveryId: c.req.header("x-github-delivery"),
      service: c.app.github,
    });
    return c.json({ received: true });
  }

  // Parsed rather than asserted: an assertion is erased at runtime, so a
  // delivery whose body is a valid JSON `null` threw on property access and
  // answered 500 instead of reaching the acknowledgment below.
  const installationEvent = installationEnvelopeSchema.safeParse(payload).data;
  const action = webhookActionSchema.safeParse(installationEvent?.action).data;
  const installationId =
    installationEvent?.installation?.id != null
      ? String(installationEvent.installation.id)
      : null;

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
    await c.app.github.handleWebhookEvent({
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

// `/api/github-langy/setup` and `/api/github-langy/webhook` are an external
// contract, held by two sets of App registrations: the hosted App, and every
// self-hosted App an operator registered while the documentation named these
// paths. Both point their Setup URL and their webhook delivery here, so the
// aliases stay mounted on the same handlers until there is a deprecation path
// that can move a registration we do not own. /install needs no alias: it is
// ours to call, and every caller in this repo uses the canonical path.
secured
  .access(publicEndpoint(SETUP_PUBLIC_REASON))
  .get("/github-langy/setup", handleSetup);

secured
  .access(publicEndpoint(WEBHOOK_PUBLIC_REASON))
  .post("/github-langy/webhook", handleWebhook);

export const app = secured.hono;
