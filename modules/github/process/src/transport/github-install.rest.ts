/**
 * The GitHub App installation flow: the session-gated start, the Setup URL,
 * the HMAC-verified webhook and the two `github-langy` aliases.
 * @see specs/integrations/github-connection.feature
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolProducer,
} from "@langwatch/api/rest";
import {
  GithubInstallationAccountMismatchError,
  GithubInstallationConflictError,
  GithubInstallationNotFromFlowError,
  githubInstallStartQuerySchema,
  githubWebhookEnvelopeSchema,
  type GithubApi,
  type GithubConnectionAuditEntry,
  type GithubInstallStatePayload,
} from "@langwatch/github-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { nowInstant } from "@langwatch/time";
import { HTTPException } from "hono/http-exception";

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

export const GithubInstallApi = moduleApi<GithubInstallApi>()("github");

const logger = createLogger("langwatch:api:github");

/** The answer a GitHub App flow writes: status, media type, body and headers, as given. */
const GITHUB_MEDIA_TYPES = ["application/json", "text/html; charset=UTF-8"] as const;
type GithubAnswer = Omit<Parameters<RestProtocolProducer["write"]>[0], "mediaType"> & {
  mediaType: (typeof GITHUB_MEDIA_TYPES)[number];
};

const INSTALL_PROTOCOL_REASON =
  "GitHub App install, setup and webhook callbacks answer GitHub's own redirects, popup " +
  "documents and bare JSON bodies, which a registered App already depends on.";

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

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
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: true })

  .get("/api/github/install", "startGithubInstallation")
  .withQuery(githubInstallStartQuerySchema)
  .withPermission("organization:manage", { at: "route", param: "organizationId" })
  .withResponse("protocol", { produces: GITHUB_MEDIA_TYPES, because: INSTALL_PROTOCOL_REASON })
  .handle(async ({ app, request, actor, response }) =>
    response.write(await startInstallation({ app, request, userId: actor.id })),
  )

  .get("/api/github/setup", "completeGithubInstallation")
  .withAccess(publicRoute({ reason: SETUP_PUBLIC_REASON }))
  .withResponse("protocol", {
    produces: GITHUB_MEDIA_TYPES,
    because: INSTALL_PROTOCOL_REASON,
  })
  .handle(async ({ app, request, response }) =>
    response.write(await completeInstallation({ app, request })),
  )

  .post("/api/github/webhook", "receiveGithubWebhook")
  // The body IS the evidence: the HMAC is computed over the exact bytes GitHub
  // sent, spacing included, so nothing parses it first.
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withAccess(publicRoute({ reason: WEBHOOK_PUBLIC_REASON }))
  .withResponse("protocol", { produces: GITHUB_MEDIA_TYPES, because: INSTALL_PROTOCOL_REASON })
  .handle(async ({ app, request, raw, response }) =>
    response.write(await receiveWebhook({ app, request, raw })),
  )

  // `/api/github-langy/setup` and `/api/github-langy/webhook` are an external
  // contract, held by the hosted App and by every self-hosted App an operator
  // registered while the documentation named these paths. They stay on the
  // same handlers until there is a deprecation path that can move a
  // registration we do not own.
  .get("/api/github-langy/setup", "completeGithubInstallationOnLegacyPath")
  .withAccess(publicRoute({ reason: SETUP_PUBLIC_REASON }))
  .withResponse("protocol", {
    produces: GITHUB_MEDIA_TYPES,
    because: INSTALL_PROTOCOL_REASON,
  })
  .handle(async ({ app, request, response }) =>
    response.write(await completeInstallation({ app, request })),
  )

  .post("/api/github-langy/webhook", "receiveGithubWebhookOnLegacyPath")
  .withRawBody("text", { mediaType: "application/json" })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES, onExceeded: payloadTooLarge })
  .withAccess(publicRoute({ reason: WEBHOOK_PUBLIC_REASON }))
  .withResponse("protocol", { produces: GITHUB_MEDIA_TYPES, because: INSTALL_PROTOCOL_REASON })
  .handle(async ({ app, request, raw, response }) =>
    response.write(await receiveWebhook({ app, request, raw })),
  )
  .build();

// ─────────────────────────────────────────────────────────────────────────────
// The answers this family writes for itself: a JSON refusal, GitHub's redirect,
// and the popup document a `mode=popup` flow closes itself from.
// ─────────────────────────────────────────────────────────────────────────────

function jsonAnswer(body: unknown, status: GithubAnswer["status"]): GithubAnswer {
  return { status, mediaType: "application/json", body: JSON.stringify(body) };
}

function redirectTo(location: string): GithubAnswer {
  return { status: 302, mediaType: "text/html; charset=UTF-8", body: null, headers: { location } };
}

const POPUP_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-ancestors 'none'";

function popupAnswer(body: string, status: GithubAnswer["status"]): GithubAnswer {
  return {
    status,
    mediaType: "text/html; charset=UTF-8",
    body,
    headers: { "content-security-policy": POPUP_CSP, "x-frame-options": "DENY" },
  };
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
  userId,
}: {
  app: GithubInstallApi;
  request: Request;
  userId: string;
}): Promise<GithubAnswer> {
  const service = app.github();

  if (!service.getAppConfig().configured) {
    return jsonAnswer({ error: "The GitHub integration is not available on this instance." }, 503);
  }

  const query = queryOf(request);
  const organizationId = query.get("organizationId") ?? "";

  if (!organizationId) {
    return jsonAnswer({ error: "organizationId query param is required" }, 400);
  }

  return redirectTo(await installUrlFor({ app, query, organizationId, userId }));
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

  const owned = await input.service.findByInstallationId(input.installationId);

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
}): Promise<GithubAnswer> {
  const service = app.github();
  const query = queryOf(request);
  const state = service.verifyInstallState(query.get("state"));
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
}): Promise<GithubAnswer> {
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

  void app
    .backfillPullRequestMappings({ organizationId: state.organizationId })
    .catch((error: unknown) => {
      logger.warn(
        { error, organizationId: state.organizationId, installationId },
        "GitHub installation pull-request backfill failed",
      );
    });

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
}): Promise<GithubAnswer | null> {
  // Re-bind the session to the state's user.
  const session = await app.resolveSession({ request });

  if (!session?.user || session.user.id !== state.userId) {
    return setupError({ app, state, errorMessage: "Session changed mid-flow", status: 401 });
  }

  // Burn the single-use nonce (skipped when Redis was down at `/install`).
  if (state.nonceRegistered) {
    const consumed = await app.github().consumeInstallNonce(state.nonce);

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
  status: GithubAnswer["status"];
}): GithubAnswer {
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
}): Promise<GithubAnswer> {
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

  const envelope = githubWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) return jsonAnswer({ error: "Invalid JSON object" }, 400);

  await service.applyWebhookPayload({
    payload: envelope.data,
    eventType: request.headers.get("x-github-event") ?? undefined,
    deliveryId: request.headers.get("x-github-delivery") ?? undefined,
  });

  return jsonAnswer({ received: true }, 200);
}
