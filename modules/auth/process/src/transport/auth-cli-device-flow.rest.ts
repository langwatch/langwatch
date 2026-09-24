import {
  ApiKeyScopeViolationError,
  type ApiKeyApi,
  type CliKeyScopeSummary,
  type CliKeySelection,
} from "@langwatch/api-key-contract";
/**
 * The CLI device grant (RFC 8628) under `/api/auth/cli`, one state machine
 * over one keyspace. ORDERING: mount this family BEFORE the `/api/auth/*`
 * catch-all. @see specs/ai-governance/cli-onboarding/
 */
import { publicRoute } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolProducer,
  type RestAnswer,
} from "@langwatch/api/rest";
import type { clientInfoSchema } from "@langwatch/auth-contract";
import {
  approveRequestSchema,
  denyRequestSchema,
  deviceCodeRequestSchema,
  exchangeRequestSchema,
  logoutRequestSchema,
  lookupQuerySchema,
  refreshRequestSchema,
} from "@langwatch/auth-contract";
import type {
  FeatureFlagApi,
  FeatureFlagKey,
  FeatureFlagTarget,
} from "@langwatch/feature-flag-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";
import type * as zodModule from "zod";

import type { AuthDirectory } from "../app/auth.members.ts";
import {
  DEVICE_CODE_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  type CliClientInfo,
  type CliDeviceCodeRecord,
  type CliDeviceSessionService,
} from "../services/cli-device-session.service.ts";

const logger = createLogger("langwatch:auth-cli");

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/**
 * The flag that gates the device-session journey. Declared here, not imported,
 * since the browser's holder is a browser module a server package may not
 * reach.
 */
const GOVERNANCE_RELEASE_FLAG: FeatureFlagKey = "release_ui_ai_governance_enabled";

/** The personal workspace a device session ships the key of. */
export type CliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string; apiKey: string }>;
}>;

/** Who is signed in, as this process resolves a browser session. */
export type CliBrowserSession = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** What the device grant calls while `auth` still has no installer. */
export interface AuthCliDeviceFlowApi {
  /** The grant's own state: device codes, the poll window, the token pair. */
  sessions: () => CliDeviceSessionService;
  /**
   * The typed client the identity and membership reads run on. Membership is
   * re-derived from rows, not trusted from the record: an admin can disable a
   * seat between approve and exchange.
   */
  directory: () => AuthDirectory;
  /** The person a browser cookie names, for the three approval-page routes. */
  session: (request: Request) => Promise<CliBrowserSession | null>;
  /**
   * The credential service the user-scoped CLI key is minted and revoked
   * through — the SAME one every other door on this process authenticates on.
   */
  apiKeys: () => Pick<
    ApiKeyApi,
    | "mintCliLoginKey"
    | "validateCliSelection"
    | "findDefaultCliSelection"
    | "revokeCliLoginKeyForLogout"
  >;
  /** Resolves or creates the caller's personal workspace. */
  ensurePersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }) => Promise<CliPersonalWorkspace>;
  /** Checks the `project:manage` gate for a shared project's base key. */
  canManageProject: (input: { userId: string; projectId: string }) => Promise<boolean>;
  /** This deployment's flag store, for the device journey's rollout gate. */
  featureFlags: () => Pick<FeatureFlagApi, "isEnabled">;
  /** The deployment's public origin, or none. */
  publicBaseUrl: () => string | undefined;
}

export const AuthCliDeviceFlowApi = moduleApi<AuthCliDeviceFlowApi>()("auth");

const JSON_MEDIA_TYPE = "application/json";

type CliDeviceFlowAnswer = Readonly<{
  status: 200 | 400 | 401 | 403 | 404 | 408 | 409 | 410 | 428 | 429 | 500;
  body: unknown;
}>;

function protocolAnswer(
  response: RestProtocolProducer<"application/json">,
  answer: CliDeviceFlowAnswer,
): RestAnswer<"protocol"> {
  return response.write({
    status: answer.status,
    mediaType: JSON_MEDIA_TYPE,
    body: JSON.stringify(answer.body),
  });
}

/**
 * The device flow answers OAuth's own bodies — `authorization_pending`,
 * `slow_down`, `expired_token` and the token response — which released CLI
 * builds parse as they stand.
 */
const CLI_DEVICE_FLOW_DOOR = publicRoute({
  reason:
    "the device flow authenticates the caller inside its own handlers — the CLI half by device code and refresh token, the browser half by the session cookie the process resolves — and answers its own 401, 403 and RFC 8628 refusals",
});

/**
 * `/api/auth/cli`, at exactly the paths released `langwatch` builds poll.
 * Literal because the flow's contract is its generation, not a date; the
 * `/api/v1` twin every `/api` family answers under is kept.
 */
export const authCliDeviceFlowRest = defineRestRouter(AuthCliDeviceFlowApi)
  .withNamespace("auth-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/auth/cli/device-code", "startCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, response }) =>
    protocolAnswer(response, await startDeviceFlow({ app, raw })),
  )

  .post("/api/auth/cli/exchange", "exchangeCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, response }) => protocolAnswer(response, await exchange({ app, raw })))

  .post("/api/auth/cli/refresh", "refreshCliDeviceSession")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, response }) => protocolAnswer(response, await refresh({ app, raw })))

  /**
   * Read by the browser approval page so it can show what is being approved.
   * Session-protected so an unauthenticated visitor cannot probe outstanding
   * device codes.
   */
  .get("/api/auth/cli/lookup", "lookupCliDeviceCode")
  .withQuery(lookupQuerySchema)
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, input, request, response }) =>
    protocolAnswer(response, await lookupDeviceFlow({ app, input, request })),
  )

  .post("/api/auth/cli/approve", "approveCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, request, response }) =>
    protocolAnswer(response, await approve({ app, raw, request })),
  )

  .post("/api/auth/cli/deny", "denyCliDeviceCode")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, request, response }) =>
    protocolAnswer(response, await denyDeviceFlow({ app, raw, request })),
  )

  /**
   * Either token may be supplied; supplying both kills both immediately.
   * Without the access token it expires naturally within the hour — a real gap
   * if stolen. The session's user-scoped key is revoked alongside.
   */
  .post("/api/auth/cli/logout", "endCliDeviceSession")
  .withRawBody("text", { mediaType: JSON_MEDIA_TYPE })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(CLI_DEVICE_FLOW_DOOR)
  .withResponse("protocol", {
    produces: JSON_MEDIA_TYPE,
    because: "RFC 8628 device-grant clients require OAuth token and polling error bodies.",
  })
  .handle(async ({ app, raw, response }) => protocolAnswer(response, await logout({ app, raw })))
  .build();

/**
 * The CLI's poll. The order is the family's whole security argument: the poll
 * window, then the record's own state, then the membership re-derived from
 * rows rather than trusted from approval time.
 */
async function exchange({
  app,
  raw,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = exchangeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) return refuse("invalid_request", "device_code is required", 400);

  const { device_code } = parsed.data;

  // Per-device polling rate limit, claimed atomically: RFC 8628 says clients
  // respect the server-issued interval, but a defensive server enforces it.
  if (!(await app.sessions().claimPollWindow(device_code))) {
    return refuse("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  const record = await app.sessions().tryFindDeviceCode(device_code);

  if (!record) {
    // Either the device_code never existed or it expired and was evicted.
    // RFC 8628 recommends `expired_token` here.
    return refuse("expired_token", "Device code expired or unknown", 408);
  }

  const unready = await refusalForState({ app, record, deviceCode: device_code });

  if (unready) return unready;

  if (!record.user_id || !record.organization_id) {
    // Should not happen — approval always populates these. Treated as a
    // transient pending state so the CLI keeps polling rather than crashing.
    logger.warn(
      `[auth-cli] approved device_code ${device_code} missing user/org payload — returning pending`,
    );

    return refuse("authorization_pending", "Approval received but session not ready yet", 428);
  }

  // Exclusive redemption: poll pacing is not a credential fence, so the loser
  // gets the same retriable `slow_down` a too-fast poll gets.
  if (!(await app.sessions().claimExchange(device_code))) {
    return refuse("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  const directory = app.directory();
  const user = await directory.tryFindPerson(record.user_id);
  const organization = await directory.tryFindOrganization(record.organization_id);

  if (!user || !organization) {
    logger.error(
      `[auth-cli] approved device_code refers to missing user (${record.user_id}) or org (${record.organization_id})`,
    );
    // Nothing was consumed, so the code stays redeemable for whatever retry
    // the CLI makes next.
    await app.sessions().releaseExchangeClaim(device_code);

    return refuse("server_error", "User or organization no longer exists", 500);
  }

  // Membership is re-derived HERE, not trusted from approval time: an admin
  // can disable the seat between approve and exchange. Refused, the device
  // code is consumed and answered with the same fatal 410 a removed member's
  // mint already gives, so the CLI stops polling for good.
  const activeMembership = await app.directory().hasActiveMembership({
    userId: user.id,
    organizationId: organization.id,
  });

  if (!activeMembership) {
    await app.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    // The claim would otherwise outlive the code it was serialising.
    await app.sessions().releaseExchangeClaim(device_code);

    return refuse("access_denied", "Not an active member of the organization", 410);
  }

  const endpoint = controlPlaneBaseUrlOf(app);

  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return projectKeyAnswer({ app, record, user, organization, endpoint });
  }

  const personalProject = await personalProjectOf({ app, user, organization });
  const minted = await mintCliKey({
    app,
    record,
    user,
    organization,
    clientInfo: parsed.data.client_info,
  });

  if ("refusal" in minted) {
    // Nothing was handed out and the code was not consumed, so the claim goes
    // back rather than blocking the CLI's next poll for half a minute.
    await app.sessions().releaseExchangeClaim(device_code);

    return minted.refusal;
  }

  // Stamp the device info so the devices inventory can show a recognisable
  // entry. `session_started_at` is preserved through later rotations so the
  // dashboard shows "logged in 5 days ago" rather than the rotation moment.
  const clientInfo: CliClientInfo | undefined = parsed.data.client_info
    ? { ...parsed.data.client_info, session_started_at: nowInstant().epochMilliseconds }
    : undefined;
  const session = await app.sessions().mintSession({
    userId: user.id,
    organizationId: organization.id,
    clientInfo,
    cliApiKeyId: minted.apiKeyId,
  });

  // Single-use device code: consumed after a successful exchange, poll window
  // included, so the next poll learns the code is gone (408) rather than that
  // it polled too soon (429). The CLAIM is deliberately left to expire — see
  // `releaseExchangeClaim`.
  await app.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

  return answer({
    kind: "device_session" as const,
    access_token: session.accessToken,
    token_type: "Bearer" as const,
    expires_in: session.accessTtlSeconds,
    refresh_token: session.refreshToken,
    refresh_expires_in: session.refreshTtlSeconds,
    user: { id: user.id, email: user.email, name: user.name },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    default_personal_vk: record.personal_vk,
    personal_project: personalProject,
    // The user-scoped key and its reach summary. Additive: an older CLI
    // ignores both and keeps using `personal_project` exactly as before.
    ...(minted.token && minted.scope
      ? { cli_api_key: minted.token, cli_api_key_scope: minted.scope }
      : {}),
    endpoint,
  });
}

/**
 * Why this grant cannot be exchanged yet, or at all, in RFC 8628's own codes.
 * Null once the record is approved and still inside its window.
 */
async function refusalForState({
  app,
  record,
  deviceCode,
}: {
  app: AuthCliDeviceFlowApi;
  record: CliDeviceCodeRecord;
  deviceCode: string;
}): Promise<CliDeviceFlowAnswer | null> {
  // Server-side expiry check, in case the store has not evicted yet.
  if (expired(record)) {
    await app.sessions().consumeDeviceCode({ record });

    return refuse("expired_token", "Device code expired", 408);
  }

  if (record.status === "denied") {
    await app.sessions().consumeDeviceCode({ record });

    return refuse("access_denied", "Authorization request was denied by the user", 410);
  }

  if (record.status === "pending") {
    return refuse("authorization_pending", "User has not yet completed authorization", 428);
  }

  if (record.status === "expired") return refuse("expired_token", "Device code expired", 408);

  if (record.status === "approved") return null;

  // Defensive: an unrecognised status.
  logger.warn(`[auth-cli] device_code ${deviceCode} carries an unrecognised state`);

  return refuse("server_error", "Unknown device code state", 500);
}

/** Returns the picked project's existing key after re-reading access and state. */
async function projectKeyAnswer({
  app,
  record,
  user,
  organization,
  endpoint,
}: {
  app: AuthCliDeviceFlowApi;
  record: CliDeviceCodeRecord;
  user: Readonly<{ id: string; email: string | null; name: string | null }>;
  organization: Readonly<{ id: string; name: string; slug: string }>;
  endpoint: string;
}): Promise<CliDeviceFlowAnswer> {
  if (!record.project_api_key) {
    logger.warn(
      `[auth-cli] approved project_api_key device_code ${record.device_code} missing project payload — returning pending`,
    );
    // Transient, and nothing was consumed: the claim goes back so the CLI's
    // next poll is not told to slow down for half a minute.
    await app.sessions().releaseExchangeClaim(record.device_code);

    return refuse("authorization_pending", "Approval received but project key not ready yet", 428);
  }

  const project = await app.directory().tryFindLiveProject({
    projectId: record.project_api_key.project_id,
    organizationId: organization.id,
  });
  const stillAdministers =
    project !== null && (await app.canManageProject({ userId: user.id, projectId: project.id }));
  const ownsItIfPersonal =
    project !== null && (!project.isPersonal || project.ownerUserId === user.id);

  if (!project || !stillAdministers || !ownsItIfPersonal) {
    // One answer for all three, because they are one fact to the caller: this
    // exchange is not entitled to that key. Which of the three it was is a
    // detail about somebody else's project, and 410 stops the CLI polling for
    // a key it will never get.
    await app.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    await app.sessions().releaseExchangeClaim(record.device_code);

    return refuse(
      "access_denied",
      "You no longer have administrator access to the selected project",
      410,
    );
  }

  // Single-use device code, poll window included; the claim is deliberately
  // left to expire — see `releaseExchangeClaim`.
  await app.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

  return answer({
    kind: "api_key" as const,
    // The key as it stands NOW, not as the approval saw it: a rotation between
    // the two would otherwise write a dead key into the caller's .env.
    api_key: project.apiKey,
    project: { id: project.id, slug: project.slug, name: project.name },
    user: { id: user.id, email: user.email, name: user.name },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    endpoint,
  });
}

/**
 * Sliding-window rotation. A rotation mints a new credential pair, so it
 * re-derives membership the way the other minting endpoints do.
 */
async function refresh({
  app,
  raw,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = refreshRequestSchema.safeParse(posted(raw));

  if (!parsed.success) return refuse("invalid_request", "refresh_token is required", 400);

  const { refresh_token } = parsed.data;
  const record = await app.sessions().findRefreshToken(refresh_token);

  // Unknown or revoked. The CLI wipes local state on 401.
  if (!record) {
    return refuse("invalid_grant", "Refresh token is invalid or revoked", 401);
  }

  if (nowInstant().epochMilliseconds > record.expires_at) {
    await app.sessions().dropRefreshToken(refresh_token);

    return refuse("invalid_grant", "Refresh token has expired", 401);
  }

  // Enforce the admin-configured maximum session duration. The anchor is
  // `client_info.session_started_at` (set at exchange and preserved across
  // rotations), falling back to the record's issue time for sessions started
  // before device metadata was captured.
  const sessionAnchorMs = record.client_info?.session_started_at ?? record.issued_at;
  const maxDurationDays = await app.directory().maxSessionDurationDays(record.organization_id);

  if (maxDurationDays > 0) {
    const sessionAgeMs = nowInstant().epochMilliseconds - sessionAnchorMs;

    if (sessionAgeMs > maxDurationDays * 24 * 60 * 60 * 1000) {
      // Reject AND invalidate the old refresh token, so no further rotation is
      // attempted. The CLI gets 401 and wipes local state.
      await app.sessions().dropRefreshToken(refresh_token);
      logger.info(
        {
          userId: record.user_id,
          organizationId: record.organization_id,
          sessionAgeDays: Math.round(sessionAgeMs / 86_400_000),
          maxDurationDays,
        },
        "rejecting refresh: session exceeded org max-duration policy",
      );

      return refuse(
        "invalid_grant",
        `Session exceeded organization max-duration policy of ${maxDurationDays} days. Please run \`langwatch login\` to start a new session.`,
        401,
      );
    }
  }

  // A bearer-only route still honours the access token already in hand until it
  // expires — one hour, the same window a removed member has; this is what
  // stops that window from rolling forward for a quarter.
  const activeMembership = await app.directory().hasActiveMembership({
    userId: record.user_id,
    organizationId: record.organization_id,
  });

  if (!activeMembership) {
    await app.sessions().dropRefreshToken(refresh_token);
    logger.info(
      { userId: record.user_id, organizationId: record.organization_id },
      "rejecting refresh: caller is not an active member of the organization",
    );

    return refuse(
      "invalid_grant",
      "Your access to this organization is no longer active. Please run `langwatch login` to start a new session.",
      401,
    );
  }

  // `session_started_at` and the CLI key id are carried across so the devices
  // inventory keeps its anchor and logout can still revoke the key.
  const rotated = await app.sessions().mintSession({
    userId: record.user_id,
    organizationId: record.organization_id,
    clientInfo: record.client_info,
    cliApiKeyId: record.cli_api_key_id,
  });

  await app.sessions().dropRefreshToken(refresh_token);

  return answer({
    access_token: rotated.accessToken,
    token_type: "Bearer",
    expires_in: rotated.accessTtlSeconds,
    refresh_token: rotated.refreshToken,
    refresh_expires_in: rotated.refreshTtlSeconds,
  });
}

/**
 * The browser's approval. Approval proves identity and stamps the key
 * SELECTION — it still mints no credential, so an approval never exchanged
 * leaves no row.
 */
async function approve({
  app,
  raw,
  request,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
  request: Request;
}): Promise<CliDeviceFlowAnswer> {
  const person = await app.session(request);

  if (!person) return refuse("unauthorized", "Sign in to continue", 401);

  const parsed = approveRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    return refuse("invalid_request", "user_code and organization_id are required", 400);
  }

  const { user_code, organization_id, project_id } = parsed.data;

  // Verify the caller is an ACTIVE member of the organization they are issuing
  // a credential for: a membership an admin disabled to reclaim its seat must
  // not approve a device and hand out a key it could not use.
  const isMember = await app.directory().hasActiveMembership({
    userId: person.id,
    organizationId: organization_id,
  });

  if (!isMember) {
    return refuse("forbidden", `Not a member of organization ${organization_id}`, 403);
  }

  const record = await app.sessions().tryFindDeviceCodeByUserCode(user_code);

  if (!record) return refuse("not_found", "Code not recognised", 404);

  if (expired(record)) return refuse("expired", "Code has expired", 410);

  if (record.status !== "pending") {
    return refuse(
      "already_resolved",
      `Code is in '${record.status}' state — restart langwatch login`,
      409,
    );
  }

  // Branch on the credential type the CLI requested at /device-code time.
  // `project_api_key` returns the picked project's EXISTING key, so other
  // consumers keep working unchanged.
  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return approveProjectKey({ app, record, person, organizationId: organization_id, project_id });
  }

  // Governance gate: provisioning a personal workspace/virtual key is a
  // governance-plane capability. Flag defaults ON, so this only fires for
  // organizations without it, pointing them at project login instead.
  const governanceTarget: FeatureFlagTarget = {
    kind: "organization",
    userId: person.id,
    userEmail: person.email ?? undefined,
    organizationId: organization_id,
  };
  const governanceEnabled = await app
    .featureFlags()
    .isEnabled(GOVERNANCE_RELEASE_FLAG, governanceTarget)
    .catch(() => true);

  if (!governanceEnabled) {
    return refuse(
      "governance_required",
      "AI-tools (device) login needs governance enabled for your organization. Re-run `langwatch login` and choose project login. It writes a project API key to your .env.",
      403,
    );
  }

  const keySelection = await selectionFor({
    app,
    person,
    organizationId: organization_id,
    requested: parsed.data.key_selection,
  });

  await app.sessions().approveDeviceCode({
    deviceCode: record.device_code,
    userId: person.id,
    organizationId: organization_id,
    keySelection,
  });

  return answer({ ok: true, organization_id });
}

/**
 * The picked project's EXISTING key, stamped onto the record for `/exchange`.
 * The picker labels personal clearly, so an explicit self-pick is honoured;
 * everything else the shared handout rule refuses.
 */
async function approveProjectKey({
  app,
  record,
  person,
  organizationId,
  project_id,
}: {
  app: AuthCliDeviceFlowApi;
  record: CliDeviceCodeRecord;
  person: CliBrowserSession;
  organizationId: string;
  project_id: string | undefined;
}): Promise<CliDeviceFlowAnswer> {
  if (!project_id) {
    return refuse(
      "invalid_request",
      "project_id is required when credential_type is project_api_key",
      400,
    );
  }

  // Resolve the picked project: it must live in the chosen organization and not
  // be archived. Authorization is NOT decided by this lookup — the write
  // permission check below is, and it inspects project-, team- and org-scoped
  // bindings. The org-scoping predicate here plus that check together stop a
  // spoofed `project_id` from leaking another org's key.
  const project = await app
    .directory()
    .tryFindLiveProject({ projectId: project_id, organizationId });

  if (!project) {
    return refuse("forbidden", "Project not found or unavailable in this organization", 403);
  }

  if (project.isPersonal && project.ownerUserId !== person.id) {
    return refuse(
      "personal_project_not_allowed",
      "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
      400,
    );
  }

  if (!(await app.canManageProject({ userId: person.id, projectId: project.id }))) {
    return refuse(
      "forbidden",
      "You need to be an administrator of this project to retrieve its API key.",
      403,
    );
  }

  await app.sessions().approveDeviceCode({
    deviceCode: record.device_code,
    userId: person.id,
    organizationId,
    projectApiKey: {
      project_id: project.id,
      project_slug: project.slug,
      project_name: project.name,
      api_key: project.apiKey,
    },
  });

  return answer({
    ok: true,
    kind: "api_key" as const,
    project: { id: project.id, slug: project.slug, name: project.name },
    organization_id: organizationId,
  });
}

/**
 * Ends a device session. Best-effort and idempotent: logout stays a 200
 * whatever state the key is in, and a failed revoke is logged rather than
 * surfaced — the key still dies with the owner's next re-login.
 */
async function logout({
  app,
  raw,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = logoutRequestSchema.safeParse(posted(raw));

  // 200 either way — logout is idempotent, and a client that sent garbage must
  // not be told its sign-out failed. There is simply nothing to revoke.
  if (!parsed.success) return answer({ ok: true });

  const records = await app.sessions().endSession({
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
  });
  const seen = new Set<string>();

  for (const record of records) {
    const apiKeyId = record.cli_api_key_id;

    if (!apiKeyId || seen.has(apiKeyId)) continue;

    seen.add(apiKeyId);

    try {
      await app.apiKeys().revokeCliLoginKeyForLogout({
        apiKeyId,
        userId: record.user_id,
        organizationId: record.organization_id,
      });
    } catch (err) {
      logger.warn(
        { err, apiKeyId, userId: record.user_id },
        "[auth-cli] failed to revoke the CLI key on logout",
      );
    }
  }

  return answer({ ok: true });
}

/** What one exchange minted, or the refusal that ends the device code. */
type MintedCliKey =
  | Readonly<{
      token?: string;
      apiKeyId?: string;
      scope?: Readonly<{
        kind: "organization" | "projects";
        project_ids: string[];
        permissions: string[];
      }>;
    }>
  | Readonly<{ refusal: CliDeviceFlowAnswer }>;

/**
 * The user-scoped CLI key, from the selection the approval stamped, so an
 * approval never exchanged mints nothing. Minted BEFORE the session tokens:
 * a mint failure fails the exchange rather than half-logging the CLI in.
 */
async function mintCliKey({
  app,
  record,
  user,
  organization,
  clientInfo,
}: {
  app: AuthCliDeviceFlowApi;
  record: CliDeviceCodeRecord;
  user: Readonly<{ id: string }>;
  organization: Readonly<{ id: string }>;
  clientInfo: z.output<typeof clientInfoSchema>;
}): Promise<MintedCliKey> {
  if (!record.key_selection) return {};

  // The same normalization every other label path uses, and the user-chosen
  // label wins over the machine hostname. The value names the key AND matches
  // the previous login key for replacement, so an unnormalized value would
  // leave the old key alive on a hostname or formatting change and let
  // credentials accumulate.
  const deviceLabel =
    normalizeDeviceLabel(clientInfo?.device_label ?? clientInfo?.hostname) ??
    CLI_LOGIN_UNKNOWN_DEVICE_LABEL;
  let minted: { token: string; apiKeyId: string; scope: CliKeyScopeSummary };

  try {
    minted = await app.apiKeys().mintCliLoginKey({
      userId: user.id,
      organizationId: organization.id,
      deviceLabel,
      selection: record.key_selection,
    });
  } catch (err) {
    // A ceiling refusal is permanent — the approver has since lost access — so
    // leaving the record approved means an endless "keep polling" loop. Burn
    // the device code and answer with the one code the CLI treats as fatal.
    if (ApiKeyScopeViolationError.is(err)) {
      logger.warn(
        { err, userId: user.id, organizationId: organization.id },
        "[auth-cli] CLI login key refused at exchange; terminating the device code",
      );
      await app.sessions().consumeDeviceCode({ record });

      return {
        refusal: refuse(
          "access_denied",
          "Your access changed after you approved this login. Run `langwatch login` again.",
          410,
        ),
      };
    }

    throw err;
  }

  return {
    token: minted.token,
    apiKeyId: minted.apiKeyId,
    scope: {
      kind: minted.scope.kind,
      project_ids: minted.scope.projectIds,
      permissions: minted.scope.permissions,
    },
  };
}

/**
 * The personal project a device session ships the key of: a normal project
 * with a normal key, ensured here (idempotent). Best-effort — a workspace
 * failure must not fail the login, and older CLIs ignore the field.
 */
async function personalProjectOf({
  app,
  user,
  organization,
}: {
  app: AuthCliDeviceFlowApi;
  user: Readonly<{ id: string; name?: string | null; email?: string | null }>;
  organization: Readonly<{ id: string }>;
}): Promise<Readonly<{ id: string; slug: string; name: string; api_key: string }> | undefined> {
  try {
    const workspace = await app.ensurePersonalWorkspace({
      organizationId: organization.id,
      userId: user.id,
      displayName: user.name,
      displayEmail: user.email,
    });

    return {
      id: workspace.project.id,
      slug: workspace.project.slug,
      name: workspace.project.name,
      api_key: workspace.project.apiKey,
    };
  } catch (err) {
    logger.error(
      { err, userId: user.id, organizationId: organization.id },
      "[auth-cli] could not ensure personal workspace on exchange; device session ships without personal_project",
    );

    return undefined;
  }
}

/**
 * The selection an approval stamps. An explicit one is validated against the
 * registry and the approver's own ceiling; a violation throws and stamps
 * nothing. A legacy client with none gets the default, best-effort.
 */
async function selectionFor({
  app,
  person,
  organizationId,
  requested,
}: {
  app: AuthCliDeviceFlowApi;
  person: CliBrowserSession;
  organizationId: string;
  requested: z.output<typeof approveRequestSchema>["key_selection"];
}): Promise<CliKeySelection | undefined> {
  if (requested) {
    return app.apiKeys().validateCliSelection({
      userId: person.id,
      organizationId,
      selection: {
        bindings: requested.bindings.map((binding) => ({
          scopeType: binding.scope_type,
          scopeId: binding.scope_id,
        })),
        permissions: requested.permissions,
      },
    });
  }

  // The personal workspace is ensured first so its team can be part of the
  // default reach — idempotent, and not a credential.
  try {
    await app.ensurePersonalWorkspace({
      organizationId,
      userId: person.id,
      displayName: person.name,
      displayEmail: person.email,
    });
  } catch (err) {
    logger.warn(
      { err, userId: person.id, organizationId },
      "[auth-cli] could not ensure personal workspace at approve; default key selection proceeds without it",
    );
  }

  try {
    return (
      (await app.apiKeys().findDefaultCliSelection({ userId: person.id, organizationId })) ??
      undefined
    );
  } catch (err) {
    logger.warn(
      { err, userId: person.id, organizationId },
      "[auth-cli] could not resolve the default key selection; device session proceeds without a scoped key",
    );

    return undefined;
  }
}

/**
 * Control-plane base URL the CLI persists post-login (no trailing slash).
 * Falls back to `https://app.langwatch.ai`, the same fallback the CLI uses
 * client-side, so the round-trip self-hosted experience stays consistent.
 */
function controlPlaneBaseUrlOf(app: AuthCliDeviceFlowApi): string {
  return (app.publicBaseUrl() ?? "https://app.langwatch.ai").replace(/\/+$/, "");
}

/** Where a person opens the approval page. */
function verificationUriOf(app: AuthCliDeviceFlowApi): string {
  return `${(app.publicBaseUrl() ?? "http://localhost:5560").replace(/\/+$/, "")}/cli/auth`;
}

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so a caller falls back to a random suffix
 * rather than naming every machine the same.
 */
function normalizeDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned.length > 0 ? cleaned : null;
}

/** Whether the grant behind a device code has already run out of time. */
function expired(record: CliDeviceCodeRecord): boolean {
  return nowInstant().epochMilliseconds > record.expires_at;
}

/** The posted document, or an empty one where the body was not a JSON object. */
function posted(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refuse(
  error: string,
  description: string,
  status: CliDeviceFlowAnswer["status"],
): CliDeviceFlowAnswer {
  return answer({ error, error_description: description }, status);
}

/** A JSON body this family writes itself, exactly as its clients read it. */
function answer(body: unknown, status: CliDeviceFlowAnswer["status"] = 200): CliDeviceFlowAnswer {
  return { status, body };
}

async function startDeviceFlow({
  app,
  raw,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = deviceCodeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    return refuse("invalid_request", parsed.error.issues[0]?.message ?? "invalid body", 400);
  }

  const record = await app.sessions().startDeviceCode({
    credentialType: parsed.data.credential_type,
  });
  const verificationUri = verificationUriOf(app);

  return answer({
    device_code: record.device_code,
    user_code: record.user_code,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(record.user_code)}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: MIN_POLL_INTERVAL_SECONDS,
  });
}

async function lookupDeviceFlow({
  app,
  input,
  request,
}: {
  app: AuthCliDeviceFlowApi;
  input: zodModule.infer<typeof lookupQuerySchema>;
  request: Request;
}): Promise<CliDeviceFlowAnswer> {
  const person = await app.session(request);

  if (!person) return refuse("unauthorized", "Sign in to continue", 401);

  if (!input.user_code) return refuse("invalid_request", "user_code is required", 400);

  const record = await app.sessions().tryFindDeviceCodeByUserCode(input.user_code);

  if (!record) {
    return refuse("not_found", "Code not recognised — it may have expired", 404);
  }

  if (expired(record)) {
    return refuse("expired", "Code has expired — restart `langwatch login`", 410);
  }

  return answer({
    user_code: record.user_code,
    status: record.status,
    created_at: record.created_at,
    expires_at: record.expires_at,
    // The approval page branches its journey on this: `device_session` shows
    // the approve-only flow, `project_api_key` shows a project picker whose
    // key is sent to the CLI. Defaults for records minted before the field.
    credential_type: record.credential_type ?? "device_session",
  });
}

async function denyDeviceFlow({
  app,
  raw,
  request,
}: {
  app: AuthCliDeviceFlowApi;
  raw: string;
  request: Request;
}): Promise<CliDeviceFlowAnswer> {
  const person = await app.session(request);

  if (!person) return refuse("unauthorized", "Sign in to continue", 401);

  const parsed = denyRequestSchema.safeParse(posted(raw));

  if (!parsed.success) return refuse("invalid_request", "user_code is required", 400);

  const record = await app.sessions().tryFindDeviceCodeByUserCode(parsed.data.user_code);

  // Idempotent — denying an unknown code is a no-op.
  if (!record) return answer({ ok: true });

  await app.sessions().denyDeviceCode(record.device_code);

  return answer({ ok: true });
}
