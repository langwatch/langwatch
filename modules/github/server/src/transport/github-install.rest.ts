/**
 * The GitHub App installation flow: the session-gated start, the Setup URL,
 * the HMAC-verified webhook and the two `github-langy` aliases.
 * @see specs/integrations/github-connection.feature
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  GithubInstallationAccountMismatchError,
  GithubInstallationConflictError,
  GithubInstallationNotFromFlowError,
  type GithubApi,
  type GithubConnectionAuditEntry,
  type GithubInstallStatePayload,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import { featureApi } from "@langwatch/runtime-composition";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

/** Who is signed in, as this process resolves a browser session. */
export type GithubInstallSession = Readonly<{ user: Readonly<{ id: string }> }>;

/**
 * What the installation flow reaches. The GitHub capability is this module's;
 * the session, the organization-management answer, the audit trail and the
 * backfill belong to the DEPLOYMENT, so they are named here beside it.
 */
export interface GithubInstallApi {
  /** The SAME capability the `github.*` procedures read. */
  github(): GithubApi;
  /**
   * The browser session behind this request. An operation the handler CALLS
   * rather than a declared fact: an instance that registered no App answers
   * 503 before it reads a session at all, and a fact resolves first.
   */
  resolveSession(input: { request: Request }): Promise<GithubInstallSession | null>;
  /**
   * Whether this person may connect GitHub for that organization. Connecting
   * grants repository access to the whole organization, so it takes
   * organization management — what every write to the connection demands.
   */
  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean>;
  /** Where a connection command — and a blocked rebind — is recorded. */
  recordAudit(entry: GithubConnectionAuditEntry): Promise<void>;
  /**
   * Relinks the coding-agent sessions whose pull requests this installation
   * can now be read through. A deployment holding no coding agents binds a
   * no-op: linkage then arrives on the branch recheck instead.
   */
  backfillPullRequestMappings(input: { organizationId: string }): Promise<void>;
}

export const GithubInstallApi = featureApi<GithubInstallApi>("github");

const logger = createLogger("langwatch:api:github");

// /install is session-gated in-handler: it requires a logged-in user and an
// org-membership check before signing state and redirecting to GitHub.
const INSTALL_HANDLER_AUTH_REASON =
  "Install-start endpoint: requires a valid application session (checked " +
  "in-handler through the module's own session operation) plus an org-membership " +
  "check before any redirect to GitHub. State token is HMAC-signed and bound to the session.";

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

/**
 * `/api/github/*` and the `/api/github-langy/*` aliases, at exactly the paths
 * the App registrations point at. Literal because the family shares the `/api`
 * prefix across two segments rather than owning one.
 */
export const githubInstallRest = defineRestRouter(GithubInstallApi)
  .withNamespace("github")
  .withVersion(MANAGEMENT_API_VERSION)
  // A browser session is the only credential anywhere near this family, and no
  // API client can present one: the family advertises no operation.
  .withCredential("session")
  .withAddressing("literal", { v1Twin: true })

  .get("/api/github/install", "startGithubInstallation")
  // No query schema: a public route may declare no scope field, and this one
  // is addressed with `organizationId`. It is read, and refused, in-handler —
  // exactly as the flow has always read it.
  .withAccess(publicRoute({ reason: INSTALL_HANDLER_AUTH_REASON }))
  .withRawResponse({ produces: ["application/json"] })
  .handle(async ({ app, request }) => startInstallation({ app, request }))

  .get("/api/github/setup", "completeGithubInstallation")
  .withAccess(publicRoute({ reason: SETUP_PUBLIC_REASON }))
  .withRawResponse({ produces: ["text/html", "application/json"] })
  .handle(async ({ app, request }) => completeInstallation({ app, request }))

  .post("/api/github/webhook", "receiveGithubWebhook")
  // The body IS the evidence: the HMAC is computed over the exact bytes GitHub
  // sent, spacing included, so nothing parses it first.
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(publicRoute({ reason: WEBHOOK_PUBLIC_REASON }))
  .withRawResponse({ produces: ["application/json"] })
  .handle(async ({ app, request, raw }) => receiveWebhook({ app, request, raw }))

  // `/api/github-langy/setup` and `/api/github-langy/webhook` are an external
  // contract, held by the hosted App and by every self-hosted App an operator
  // registered while the documentation named these paths. They stay on the
  // same handlers until there is a deprecation path that can move a
  // registration we do not own.
  .get("/api/github-langy/setup", "completeGithubInstallationOnLegacyPath")
  .withAccess(publicRoute({ reason: SETUP_PUBLIC_REASON }))
  .withRawResponse({ produces: ["text/html", "application/json"] })
  .handle(async ({ app, request }) => completeInstallation({ app, request }))

  .post("/api/github-langy/webhook", "receiveGithubWebhookOnLegacyPath")
  .withRawBody("text", { mediaType: "application/json" })
  .withAccess(publicRoute({ reason: WEBHOOK_PUBLIC_REASON }))
  .withRawResponse({ produces: ["application/json"] })
  .handle(async ({ app, request, raw }) => receiveWebhook({ app, request, raw }))
  .build();

// ─────────────────────────────────────────────────────────────────────────────
// The answers this family writes for itself: a JSON refusal, GitHub's redirect,
// and the popup document a `mode=popup` flow closes itself from.
// ─────────────────────────────────────────────────────────────────────────────

function jsonAnswer(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

const POPUP_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-ancestors 'none'";

function popupAnswer(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "content-security-policy": POPUP_CSP,
      "x-frame-options": "DENY",
    },
  });
}

/** The query the flow reads for itself, because its door declares none. */
function queryOf(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

// ─────────────────────────────────────────────────────────────────────────────
// `/install`: the flow's own start.
// ─────────────────────────────────────────────────────────────────────────────

async function startInstallation({
  app,
  request,
}: {
  app: GithubInstallApi;
  request: Request;
}): Promise<Response> {
  const service = app.github();

  if (!service.getAppConfig().configured) {
    return jsonAnswer({ error: "The GitHub integration is not available on this instance." }, 503);
  }

  const session = await app.resolveSession({ request });

  if (!session?.user) return jsonAnswer({ error: "Not authenticated" }, 401);

  const query = queryOf(request);
  const organizationId = query.get("organizationId") ?? "";

  if (!organizationId) {
    return jsonAnswer({ error: "organizationId query param is required" }, 400);
  }

  const refusal = await refuseUnauthorizedStart({
    app,
    userId: session.user.id,
    organizationId,
  });

  if (refusal) return refusal;

  return redirectTo(
    await installUrlFor({ app, query, organizationId, userId: session.user.id }),
  );
}

/**
 * The cross-tenant guard FIRST, so a non-member's response never depends on
 * anything about that organization, then the connect permission.
 */
async function refuseUnauthorizedStart({
  app,
  userId,
  organizationId,
}: {
  app: GithubInstallApi;
  userId: string;
  organizationId: string;
}): Promise<Response | null> {
  const isMember = await app.github().isOrganizationMember({ userId, organizationId });

  if (!isMember) return jsonAnswer({ error: "Not a member of this organization." }, 403);

  const canManage = await app.canManageOrganization({ userId, organizationId });

  if (!canManage) return jsonAnswer({ error: "Forbidden" }, 403);

  return null;
}

/**
 * GitHub redirects back to the App's configured Setup URL after install, and
 * the signed `state` round-trips so `/setup` can bind the installation to the
 * organization this flow was started for.
 */
async function installUrlFor({
  app,
  query,
  organizationId,
  userId,
}: {
  app: GithubInstallApi;
  query: URLSearchParams;
  organizationId: string;
  userId: string;
}): Promise<string> {
  const service = app.github();
  const nonce = randomBytes(16).toString("base64url");
  const nonceRegistered = await service.registerInstallNonce({
    nonce,
    ttlSec: Math.ceil(service.getInstallStateTtlMs() / 1000),
  });

  const expected = await resolveExpectedInstallationTarget({
    service,
    organizationId,
    accountLogin: query.get("account") ?? undefined,
    installationId: query.get("installationId") ?? undefined,
  });

  const state = service.signInstallState({
    userId,
    organizationId,
    mode: query.get("mode") === "popup" ? "popup" : "redirect",
    returnTo: safeReturnTo(query.get("return")),
    issuedAt: nowInstant().epochMilliseconds,
    nonce,
    nonceRegistered,
    ...expected,
  });

  const url = new URL(service.getAppInstallUrl());

  url.searchParams.set("state", state);

  return url.toString();
}

/**
 * What this flow will accept back from GitHub. A named account is bound into
 * the signed state; an installation id is pinned only when this organization
 * already owns it, so a supplied id cannot widen what the flow accepts.
 */
async function resolveExpectedInstallationTarget(input: {
  service: GithubApi;
  organizationId: string;
  accountLogin: string | undefined;
  installationId: string | undefined;
}): Promise<{ expectedAccountLogin?: string; expectedInstallationId?: string }> {
  const target: { expectedAccountLogin?: string; expectedInstallationId?: string } = {};

  if (input.accountLogin) target.expectedAccountLogin = input.accountLogin;

  if (!input.installationId) return target;

  const owned = await input.service.tryGetByInstallationId(input.installationId);

  if (owned && owned.organizationId === input.organizationId) {
    target.expectedInstallationId = owned.installationId;
    target.expectedAccountLogin = owned.accountLogin;
  }

  return target;
}

/** Only internal relative paths are followed, so nothing here opens a redirect. */
function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/settings/integrations#github";

  if (!raw) return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/")) return fallback;
  const isProtocolRelative = raw.startsWith("//") || raw.startsWith("/\\");

  if (isProtocolRelative) return fallback;
  if (/[\r\n\t\0]/.test(raw)) return fallback;

  return raw;
}

function withGithubError(returnTo: string, message: string): string {
  const url = new URL(returnTo, "http://relative.invalid");

  url.searchParams.set("githubError", message);

  return `${url.pathname}${url.search}${url.hash}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// `/setup`: GitHub's post-install redirect, on both the current path and the
// `github-langy` one.
// ─────────────────────────────────────────────────────────────────────────────

async function completeInstallation({
  app,
  request,
}: {
  app: GithubInstallApi;
  request: Request;
}): Promise<Response> {
  const service = app.github();
  const query = queryOf(request);
  const state = service.tryVerifyInstallState(query.get("state"));
  const installationId = query.get("installation_id");

  if (!state || !installationId) {
    return setupError({
      app,
      state,
      errorMessage: "Invalid state or missing installation",
      status: 400,
    });
  }

  const rejection = await rejectUnauthorizedSetup({ app, request, state });

  if (rejection) return rejection;

  return recordInstallation({ app, state, installationId });
}

/** The write, its audit line, and the two ways it is reported back. */
async function recordInstallation({
  app,
  state,
  installationId,
}: {
  app: GithubInstallApi;
  state: GithubInstallStatePayload;
  installationId: string;
}): Promise<Response> {
  const service = app.github();
  const returnTo = safeReturnTo(state.returnTo);
  let accountLogin: string;

  try {
    ({ accountLogin } = await service.recordInstallation({
      installationId,
      organizationId: state.organizationId,
      flowStartedAt: state.issuedAt,
      expectedAccountLogin: state.expectedAccountLogin,
      expectedInstallationId: state.expectedInstallationId,
    }));
  } catch (err) {
    await reportInstallationFailure({ err, app, state });

    const message = "GitHub installation failed. Please try again.";

    return state.mode === "popup"
      ? popupAnswer(service.popupErrorHtml(message), 502)
      : redirectTo(withGithubError(returnTo, message));
  }

  void app.backfillPullRequestMappings({ organizationId: state.organizationId }).catch(
    (error: unknown) => {
      logger.warn(
        { error, organizationId: state.organizationId, installationId },
        "GitHub installation pull-request backfill failed",
      );
    },
  );

  await recordInstallAudit({ app, state, installationId, accountLogin });

  return state.mode === "popup"
    ? popupAnswer(service.popupResponseHtml(accountLogin), 200)
    : redirectTo(returnTo);
}

/**
 * Every re-check standing between `/install` and GitHub's redirect back here.
 * Answers the response that rejects the flow, or null to let it proceed.
 */
async function rejectUnauthorizedSetup({
  app,
  request,
  state,
}: {
  app: GithubInstallApi;
  request: Request;
  state: GithubInstallStatePayload;
}): Promise<Response | null> {
  // Re-bind the session to the state's user.
  const session = await app.resolveSession({ request });

  if (!session?.user || session.user.id !== state.userId) {
    return setupError({ app, state, errorMessage: "Session changed mid-flow", status: 401 });
  }

  // Burn the single-use nonce (skipped when Redis was down at `/install`).
  if (state.nonceRegistered) {
    const consumed = await app.github().tryConsumeInstallNonce(state.nonce);

    if (consumed === false) {
      return setupError({
        app,
        state,
        errorMessage: "Installation link already used",
        status: 401,
      });
    }
  }

  // Re-check tenant membership (defense in depth against a stale state).
  const isMember = await app.github().isOrganizationMember({
    userId: state.userId,
    organizationId: state.organizationId,
  });

  if (!isMember) {
    return setupError({
      app,
      state,
      errorMessage: "Not a member of this organization",
      status: 403,
    });
  }

  // The caller's role may have been lowered between `/install` and the redirect
  // back here, and recording the installation is the write it gates.
  const canManage = await app.canManageOrganization({
    userId: state.userId,
    organizationId: state.organizationId,
  });

  if (!canManage) return setupError({ app, state, errorMessage: "Forbidden", status: 403 });

  return null;
}

/** The setup error path, worded the same way in popup and redirect modes. */
function setupError({
  app,
  state,
  errorMessage,
  status,
}: {
  app: GithubInstallApi;
  state: GithubInstallStatePayload | null;
  errorMessage: string;
  status: number;
}): Response {
  if (state && state.mode === "redirect") {
    return redirectTo(withGithubError(safeReturnTo(state.returnTo), errorMessage));
  }

  return popupAnswer(app.github().popupErrorHtml(errorMessage), status);
}

/** A claim one of the three ownership guards turned away, and its audit name. */
type BlockedInstallationClaim = Readonly<{
  action: string;
  installationId: string;
  attemptedOrganizationId: string;
}>;

/**
 * The refused claim behind a failure, or null when the failure was not one.
 * Each guard names its own audit action, so the three refusals are told apart.
 */
function blockedClaimOf(err: unknown): BlockedInstallationClaim | null {
  if (err instanceof GithubInstallationConflictError) {
    return { action: "github.connection.install.rejected_cross_tenant", ...claimOf(err) };
  }

  if (err instanceof GithubInstallationNotFromFlowError) {
    return { action: "github.connection.install.rejected_foreign_installation", ...claimOf(err) };
  }

  if (err instanceof GithubInstallationAccountMismatchError) {
    return { action: "github.connection.install.rejected_account_mismatch", ...claimOf(err) };
  }

  return null;
}

/** The two fields every refusal carries about what was claimed. */
function claimOf(err: {
  installationId: string;
  attemptedOrganizationId: string;
}): Omit<BlockedInstallationClaim, "action"> {
  return {
    installationId: err.installationId,
    attemptedOrganizationId: err.attemptedOrganizationId,
  };
}

/**
 * A takeover attempt is a security event, not an ordinary failure: audit it
 * against the acting user and organization so it is visible.
 */
async function reportInstallationFailure({
  err,
  app,
  state,
}: {
  err: unknown;
  app: GithubInstallApi;
  state: GithubInstallStatePayload;
}): Promise<void> {
  const claim = blockedClaimOf(err);

  if (!claim) {
    logger.warn({ err }, "github installation record failed");

    return;
  }

  logger.warn(
    {
      installationId: claim.installationId,
      attemptedOrganizationId: claim.attemptedOrganizationId,
      userId: state.userId,
    },
    "blocked github installation claim",
  );

  try {
    await app.recordAudit({
      userId: state.userId,
      organizationId: state.organizationId,
      action: claim.action,
      args: { installationId: claim.installationId },
    });
  } catch (auditErr) {
    logger.warn({ err: auditErr }, "audit log write failed after blocked rebind");
  }
}

/**
 * The installation is already recorded by the time this runs, so honour the
 * success over audit completeness; a failed write stays operator-visible
 * through this logger.
 */
async function recordInstallAudit({
  app,
  state,
  installationId,
  accountLogin,
}: {
  app: GithubInstallApi;
  state: GithubInstallStatePayload;
  installationId: string;
  accountLogin: string;
}): Promise<void> {
  try {
    await app.recordAudit({
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

// ─────────────────────────────────────────────────────────────────────────────
// `/webhook`: installation created/deleted/suspend/unsuspend,
// installation_repositories added/removed, and pull_request. Verified by HMAC,
// idempotent, and acknowledged whatever happens.
// ─────────────────────────────────────────────────────────────────────────────

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

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

async function receiveWebhook({
  app,
  request,
  raw,
}: {
  app: GithubInstallApi;
  request: Request;
  raw: string;
}): Promise<Response> {
  const service = app.github();
  const secret = service.getAppConfig().webhookSecret;

  if (!secret) return jsonAnswer({ error: "Webhook not configured" }, 404);

  const signature = request.headers.get("x-hub-signature-256") ?? undefined;
  const signed = verifyWebhookSignature(raw, signature, secret);

  if (!signed) return jsonAnswer({ error: "Invalid signature" }, 401);

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonAnswer({ error: "Invalid JSON" }, 400);
  }

  const eventType = request.headers.get("x-github-event") ?? undefined;

  if (eventType === "pull_request") {
    await applyPullRequestEvent({
      payload,
      deliveryId: request.headers.get("x-github-delivery") ?? undefined,
      service,
    });

    return jsonAnswer({ received: true }, 200);
  }

  await applyInstallationEvent({ payload, eventType, service });

  return jsonAnswer({ received: true }, 200);
}

/**
 * Parsed rather than asserted: an assertion is erased at runtime, so a delivery
 * whose body is a valid JSON `null` threw on property access and answered 500
 * instead of reaching the acknowledgment.
 */
async function applyInstallationEvent({
  payload,
  eventType,
  service,
}: {
  payload: unknown;
  eventType: string | undefined;
  service: GithubApi;
}): Promise<void> {
  const event = installationEnvelopeSchema.safeParse(payload).data;
  const action = webhookActionSchema.safeParse(event?.action).data;
  const installationId = event?.installation?.id != null ? String(event.installation.id) : null;

  // Unknown or unrelated event — acked so GitHub does not retry.
  if (eventType !== "installation" && eventType !== "installation_repositories") return;
  if (!installationId || !action) return;

  try {
    await service.handleWebhookEvent({ action, installationId });
  } catch (err) {
    // Still ack — retries won't help a persistent handling error, and the next
    // event (or the setup callback) reconciles.
    logger.warn({ err, action, installationId }, "github webhook handling failed");
  }
}

/**
 * A `pull_request` delivery: link the head branch to its pull request now,
 * rather than waiting for that branch's next scheduled recheck, which for a
 * branch asked about a few times already is up to a day away.
 */
async function applyPullRequestEvent({
  payload,
  deliveryId,
  service,
}: {
  payload: unknown;
  deliveryId: string | undefined;
  service: GithubApi;
}): Promise<void> {
  const event = service.tryParsePullRequestEvent(payload);

  if (!event) {
    // The parser declines four different deliveries, and every one still
    // answers 200; without this line a linkage outage looks like an unbroken
    // run of successful deliveries. The payload is deliberately not logged.
    logger.info({ deliveryId }, "github pull request delivery dropped before linkage");

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
