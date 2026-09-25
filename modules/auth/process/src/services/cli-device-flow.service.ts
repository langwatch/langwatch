import {
  ApiKeyScopeViolationError,
  type ApiKeyApi,
  type CliKeyScopeSummary,
  type CliKeySelection,
} from "@langwatch/api-key-contract";
import type { clientInfoSchema, lookupQuerySchema } from "@langwatch/auth-contract";
import {
  CliDeviceFlowRefusedError,
  approveRequestSchema,
  denyRequestSchema,
  deviceCodeRequestSchema,
  exchangeRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
} from "@langwatch/auth-contract";
import type {
  FeatureFlagApi,
  FeatureFlagKey,
  FeatureFlagTarget,
} from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
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
} from "./cli-device-session.service.ts";

/** The CLI device grant (RFC 8628). @see specs/ai-governance/cli-onboarding/ */
const logger = createLogger("langwatch:auth-cli");

const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/** The flag that gates the device-session journey. */
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

/** What the approval page's lookup reads: the query and the browser's own headers. */
export type CliDeviceCodeLookup = Readonly<{
  input: zodModule.infer<typeof lookupQuerySchema>;
  headers: Headers;
}>;

/** One device-flow answer: the OAuth body the CLI parses. Refusals are thrown. */
export type CliDeviceFlowAnswer = Readonly<{ status: 200; body: unknown }>;

/** What the device grant runs on. */
export interface CliDeviceFlowCollaborators {
  /** The grant's own state: device codes, the poll window, the token pair. */
  sessions: () => CliDeviceSessionService;
  /**
   * The typed client the identity and membership reads run on. Membership is
   * re-derived from rows, not trusted from the record: an admin can disable a
   * seat between approve and exchange.
   */
  directory: () => AuthDirectory;
  /** The person a browser cookie names, for the three approval-page routes. */
  session: (headers: Headers) => Promise<CliBrowserSession | null>;
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

/** The device grant's operations, each one route of `/api/auth/cli`, over its collaborators. */
export class CliDeviceFlowService {
  readonly #flow: CliDeviceFlowCollaborators;

  private constructor(flow: CliDeviceFlowCollaborators) {
    this.#flow = flow;
  }

  static create({
    collaborators,
  }: {
    collaborators: CliDeviceFlowCollaborators;
  }): CliDeviceFlowService {
    return new CliDeviceFlowService(collaborators);
  }

  startDeviceCode({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return startDeviceFlow({ flow: this.#flow, raw });
  }

  exchangeDeviceCode({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return exchange({ flow: this.#flow, raw });
  }

  refreshSession({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return refresh({ flow: this.#flow, raw });
  }

  lookupDeviceCode(input: CliDeviceCodeLookup): Promise<CliDeviceFlowAnswer> {
    return lookupDeviceFlow({ flow: this.#flow, ...input });
  }

  approveDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return approve({ flow: this.#flow, ...input });
  }

  denyDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return denyDeviceFlow({ flow: this.#flow, ...input });
  }

  endSession({ raw }: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return logout({ flow: this.#flow, raw });
  }
}

/**
 * The CLI's poll. The order is the family's whole security argument: the poll
 * window, then the record's own state, then the membership re-derived from
 * rows rather than trusted from approval time.
 */
async function exchange({
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = exchangeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "device_code is required", 400);

  const { device_code } = parsed.data;

  // Per-device polling rate limit, claimed atomically: RFC 8628 says clients
  // respect the server-issued interval, but a defensive server enforces it.
  if (!(await flow.sessions().claimPollWindow(device_code))) {
    throw refused("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  const record = await flow.sessions().getDeviceCode(device_code);

  await assertExchangeable({ flow, record, deviceCode: device_code });

  if (!record.user_id || !record.organization_id) {
    // Should not happen — approval always populates these. Treated as a
    // transient pending state so the CLI keeps polling rather than crashing.
    logger.warn(
      `[auth-cli] approved device_code ${device_code} missing user/org payload — returning pending`,
    );

    throw refused("authorization_pending", "Approval received but session not ready yet", 428);
  }

  // Exclusive redemption: poll pacing is not a credential fence, so the loser
  // gets the same retriable `slow_down` a too-fast poll gets.
  if (!(await flow.sessions().claimExchange(device_code))) {
    throw refused("slow_down", "Polling too fast. Increase your interval before retrying.", 429);
  }

  const directory = flow.directory();
  const [user, organization] = await Promise.all([
    directory.getPerson(record.user_id),
    directory.getOrganization(record.organization_id),
  ]).catch(async (error: unknown) => {
    if (!isPersonOrOrganizationGone(error)) throw error;
    logger.error(
      `[auth-cli] approved device_code refers to missing user (${record.user_id}) or org (${record.organization_id})`,
    );
    // Nothing was consumed, so the code stays redeemable for whatever retry
    // the CLI makes next.
    await flow.sessions().releaseExchangeClaim(device_code);

    throw refused("server_error", "User or organization no longer exists", 500);
  });

  // Membership is re-derived HERE, not trusted from approval time: an admin
  // can disable the seat between approve and exchange. Refused, the device
  // code is consumed and answered with the same fatal 410 a removed member's
  // mint already gives, so the CLI stops polling for good.
  const activeMembership = await flow.directory().hasActiveMembership({
    userId: user.id,
    organizationId: organization.id,
  });

  if (!activeMembership) {
    await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    // The claim would otherwise outlive the code it was serialising.
    await flow.sessions().releaseExchangeClaim(device_code);

    throw refused("access_denied", "Not an active member of the organization", 410);
  }

  const endpoint = controlPlaneBaseUrlOf(flow);

  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return projectKeyAnswer({ flow, record, user, organization, endpoint });
  }

  const personalProject = await personalProjectFieldsOf({ flow, user, organization });
  const minted = await mintCliKey({
    flow,
    record,
    user,
    organization,
    clientInfo: parsed.data.client_info,
  });

  // Stamp the device info so the devices inventory can show a recognisable
  // entry. `session_started_at` is preserved through later rotations so the
  // dashboard shows "logged in 5 days ago" rather than the rotation moment.
  const clientInfo: CliClientInfo | undefined = parsed.data.client_info
    ? { ...parsed.data.client_info, session_started_at: nowInstant().epochMilliseconds }
    : undefined;
  const session = await flow.sessions().mintSession({
    userId: user.id,
    organizationId: organization.id,
    clientInfo,
    cliApiKeyId: minted.apiKeyId,
  });

  // Single-use device code: consumed after a successful exchange, poll window
  // included, so the next poll learns the code is gone (408) rather than that
  // it polled too soon (429). The CLAIM is deliberately left to expire — see
  // `releaseExchangeClaim`.
  await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

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
    ...personalProject,
    // The user-scoped key and its reach summary. Additive: an older CLI
    // ignores both and keeps using `personal_project` exactly as before.
    ...(minted.token && minted.scope
      ? { cli_api_key: minted.token, cli_api_key_scope: minted.scope }
      : {}),
    endpoint,
  });
}

/**
 * Refuses a grant that cannot be exchanged yet, or at all, in RFC 8628's own
 * codes; returns once the record is approved and still inside its window.
 */
async function assertExchangeable({
  flow,
  record,
  deviceCode,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  deviceCode: string;
}): Promise<void> {
  // Server-side expiry check, in case the store has not evicted yet.
  if (expired(record)) {
    await flow.sessions().consumeDeviceCode({ record });

    throw refused("expired_token", "Device code expired", 408);
  }

  if (record.status === "denied") {
    await flow.sessions().consumeDeviceCode({ record });

    throw refused("access_denied", "Authorization request was denied by the user", 410);
  }

  if (record.status === "pending") {
    throw refused("authorization_pending", "User has not yet completed authorization", 428);
  }

  if (record.status === "expired") throw refused("expired_token", "Device code expired", 408);

  if (record.status === "approved") return;

  // Defensive: an unrecognised status.
  logger.warn(`[auth-cli] device_code ${deviceCode} carries an unrecognised state`);

  throw refused("server_error", "Unknown device code state", 500);
}

/** Returns the picked project's existing key after re-reading access and state. */
async function projectKeyAnswer({
  flow,
  record,
  user,
  organization,
  endpoint,
}: {
  flow: CliDeviceFlowCollaborators;
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
    await flow.sessions().releaseExchangeClaim(record.device_code);

    throw refused("authorization_pending", "Approval received but project key not ready yet", 428);
  }

  const project = await flow
    .directory()
    .getLiveProject({
      projectId: record.project_api_key.project_id,
      organizationId: organization.id,
    })
    .catch((error: unknown) => {
      if (isProjectGone(error)) return null;
      throw error;
    });
  const stillAdministers =
    project !== null && (await flow.canManageProject({ userId: user.id, projectId: project.id }));
  const ownsItIfPersonal =
    project !== null && (!project.isPersonal || project.ownerUserId === user.id);

  if (!project || !stillAdministers || !ownsItIfPersonal) {
    // One answer for all three, because they are one fact to the caller: this
    // exchange is not entitled to that key. Which of the three it was is a
    // detail about somebody else's project, and 410 stops the CLI polling for
    // a key it will never get.
    await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });
    await flow.sessions().releaseExchangeClaim(record.device_code);

    throw refused(
      "access_denied",
      "You no longer have administrator access to the selected project",
      410,
    );
  }

  // Single-use device code, poll window included; the claim is deliberately
  // left to expire — see `releaseExchangeClaim`.
  await flow.sessions().consumeDeviceCode({ record, alsoPollWindow: true });

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
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = refreshRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "refresh_token is required", 400);

  const { refresh_token } = parsed.data;
  const record = await flow.sessions().getRefreshToken(refresh_token);

  if (nowInstant().epochMilliseconds > record.expires_at) {
    await flow.sessions().dropRefreshToken(refresh_token);

    throw refused("invalid_grant", "Refresh token has expired", 401);
  }

  // Enforce the admin-configured maximum session duration. The anchor is
  // `client_info.session_started_at` (set at exchange and preserved across
  // rotations), falling back to the record's issue time for sessions started
  // before device metadata was captured.
  const sessionAnchorMs = record.client_info?.session_started_at ?? record.issued_at;
  const maxDurationDays = await flow.directory().maxSessionDurationDays(record.organization_id);

  if (maxDurationDays > 0) {
    const sessionAgeMs = nowInstant().epochMilliseconds - sessionAnchorMs;

    if (sessionAgeMs > maxDurationDays * 24 * 60 * 60 * 1000) {
      // Reject AND invalidate the old refresh token, so no further rotation is
      // attempted. The CLI gets 401 and wipes local state.
      await flow.sessions().dropRefreshToken(refresh_token);
      logger.info(
        {
          userId: record.user_id,
          organizationId: record.organization_id,
          sessionAgeDays: Math.round(sessionAgeMs / 86_400_000),
          maxDurationDays,
        },
        "rejecting refresh: session exceeded org max-duration policy",
      );

      throw refused(
        "invalid_grant",
        `Session exceeded organization max-duration policy of ${maxDurationDays} days. Please run \`langwatch login\` to start a new session.`,
        401,
      );
    }
  }

  // A bearer-only route still honours the access token already in hand until it
  // expires — one hour, the same window a removed member has; this is what
  // stops that window from rolling forward for a quarter.
  const activeMembership = await flow.directory().hasActiveMembership({
    userId: record.user_id,
    organizationId: record.organization_id,
  });

  if (!activeMembership) {
    await flow.sessions().dropRefreshToken(refresh_token);
    logger.info(
      { userId: record.user_id, organizationId: record.organization_id },
      "rejecting refresh: caller is not an active member of the organization",
    );

    throw refused(
      "invalid_grant",
      "Your access to this organization is no longer active. Please run `langwatch login` to start a new session.",
      401,
    );
  }

  // `session_started_at` and the CLI key id are carried across so the devices
  // inventory keeps its anchor and logout can still revoke the key.
  const rotated = await flow.sessions().mintSession({
    userId: record.user_id,
    organizationId: record.organization_id,
    clientInfo: record.client_info,
    cliApiKeyId: record.cli_api_key_id,
  });

  await flow.sessions().dropRefreshToken(refresh_token);

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
  flow,
  raw,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  const parsed = approveRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    throw refused("invalid_request", "user_code and organization_id are required", 400);
  }

  const { user_code, organization_id, project_id } = parsed.data;

  // Verify the caller is an ACTIVE member of the organization they are issuing
  // a credential for: a membership an admin disabled to reclaim its seat must
  // not approve a device and hand out a key it could not use.
  const isMember = await flow.directory().hasActiveMembership({
    userId: person.id,
    organizationId: organization_id,
  });

  if (!isMember) {
    throw refused("forbidden", `Not a member of organization ${organization_id}`, 403);
  }

  const record = await flow.sessions().getDeviceCodeByUserCode({
    userCode: user_code,
    unknownDescription: "Code not recognised",
  });

  if (expired(record)) throw refused("expired", "Code has expired", 410);

  if (record.status !== "pending") {
    throw refused(
      "already_resolved",
      `Code is in '${record.status}' state — restart langwatch login`,
      409,
    );
  }

  // Branch on the credential type the CLI requested at /device-code time.
  // `project_api_key` returns the picked project's EXISTING key, so other
  // consumers keep working unchanged.
  if ((record.credential_type ?? "device_session") === "project_api_key") {
    return approveProjectKey({ flow, record, person, organizationId: organization_id, project_id });
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
  const governanceEnabled = await flow
    .featureFlags()
    .isEnabled(GOVERNANCE_RELEASE_FLAG, governanceTarget)
    .catch(() => true);

  if (!governanceEnabled) {
    throw refused(
      "governance_required",
      "AI-tools (device) login needs governance enabled for your organization. Re-run `langwatch login` and choose project login. It writes a project API key to your .env.",
      403,
    );
  }

  const keySelection = await keySelectionFieldsFor({
    flow,
    person,
    organizationId: organization_id,
    requested: parsed.data.key_selection,
  });

  await flow.sessions().approveDeviceCode({
    deviceCode: record.device_code,
    userId: person.id,
    organizationId: organization_id,
    ...keySelection,
  });

  return answer({ ok: true, organization_id });
}

/**
 * The picked project's EXISTING key, stamped onto the record for `/exchange`.
 * The picker labels personal clearly, so an explicit self-pick is honoured;
 * everything else the shared handout rule refuses.
 */
async function approveProjectKey({
  flow,
  record,
  person,
  organizationId,
  project_id,
}: {
  flow: CliDeviceFlowCollaborators;
  record: CliDeviceCodeRecord;
  person: CliBrowserSession;
  organizationId: string;
  project_id: string | undefined;
}): Promise<CliDeviceFlowAnswer> {
  if (!project_id) {
    throw refused(
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
  const project = await flow
    .directory()
    .getLiveProject({ projectId: project_id, organizationId })
    .catch((error: unknown) => {
      if (isProjectGone(error)) {
        throw refused("forbidden", "Project not found or unavailable in this organization", 403);
      }
      throw error;
    });

  if (project.isPersonal && project.ownerUserId !== person.id) {
    throw refused(
      "personal_project_not_allowed",
      "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
      400,
    );
  }

  if (!(await flow.canManageProject({ userId: person.id, projectId: project.id }))) {
    throw refused(
      "forbidden",
      "You need to be an administrator of this project to retrieve its API key.",
      403,
    );
  }

  await flow.sessions().approveDeviceCode({
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
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = logoutRequestSchema.safeParse(posted(raw));

  // 200 either way — logout is idempotent, and a client that sent garbage must
  // not be told its sign-out failed. There is simply nothing to revoke.
  if (!parsed.success) return answer({ ok: true });

  const records = await flow.sessions().endSession({
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
  });
  const seen = new Set<string>();

  for (const record of records) {
    const apiKeyId = record.cli_api_key_id;

    if (!apiKeyId || seen.has(apiKeyId)) continue;

    seen.add(apiKeyId);

    try {
      await flow.apiKeys().revokeCliLoginKeyForLogout({
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

/** What one exchange minted; nothing when the approval stamped no selection. */
type MintedCliKey = Readonly<{
  token?: string;
  apiKeyId?: string;
  scope?: Readonly<{
    kind: "organization" | "projects";
    project_ids: string[];
    permissions: string[];
  }>;
}>;

/**
 * The user-scoped CLI key, from the selection the approval stamped, so an
 * approval never exchanged mints nothing. Minted BEFORE the session tokens:
 * a mint failure fails the exchange rather than half-logging the CLI in.
 */
async function mintCliKey({
  flow,
  record,
  user,
  organization,
  clientInfo,
}: {
  flow: CliDeviceFlowCollaborators;
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
    minted = await flow.apiKeys().mintCliLoginKey({
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
      await flow.sessions().consumeDeviceCode({ record });
      // Nothing was handed out, so the claim goes back rather than blocking
      // the CLI's next poll for half a minute.
      await flow.sessions().releaseExchangeClaim(record.device_code);

      throw refused(
        "access_denied",
        "Your access changed after you approved this login. Run `langwatch login` again.",
        410,
      );
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
async function personalProjectFieldsOf({
  flow,
  user,
  organization,
}: {
  flow: CliDeviceFlowCollaborators;
  user: Readonly<{ id: string; name?: string | null; email?: string | null }>;
  organization: Readonly<{ id: string }>;
}): Promise<
  Readonly<{
    personal_project?: Readonly<{ id: string; slug: string; name: string; api_key: string }>;
  }>
> {
  try {
    const workspace = await flow.ensurePersonalWorkspace({
      organizationId: organization.id,
      userId: user.id,
      displayName: user.name,
      displayEmail: user.email,
    });

    return {
      personal_project: {
        id: workspace.project.id,
        slug: workspace.project.slug,
        name: workspace.project.name,
        api_key: workspace.project.apiKey,
      },
    };
  } catch (err) {
    logger.error(
      { err, userId: user.id, organizationId: organization.id },
      "[auth-cli] could not ensure personal workspace on exchange; device session ships without personal_project",
    );

    return {};
  }
}

/**
 * The selection an approval stamps. An explicit one is validated against the
 * registry and the approver's own ceiling; a violation throws and stamps
 * nothing. A legacy client with none gets the default, best-effort.
 */
async function keySelectionFieldsFor({
  flow,
  person,
  organizationId,
  requested,
}: {
  flow: CliDeviceFlowCollaborators;
  person: CliBrowserSession;
  organizationId: string;
  requested: z.output<typeof approveRequestSchema>["key_selection"];
}): Promise<Readonly<{ keySelection?: CliKeySelection }>> {
  if (requested) {
    const keySelection = await flow.apiKeys().validateCliSelection({
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

    return { keySelection };
  }

  // The personal workspace is ensured first so its team can be part of the
  // default reach — idempotent, and not a credential.
  try {
    await flow.ensurePersonalWorkspace({
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
    const keySelection = await flow
      .apiKeys()
      .findDefaultCliSelection({ userId: person.id, organizationId });

    return keySelection ? { keySelection } : {};
  } catch (err) {
    logger.warn(
      { err, userId: person.id, organizationId },
      "[auth-cli] could not resolve the default key selection; device session proceeds without a scoped key",
    );

    return {};
  }
}

/**
 * Control-plane base URL the CLI persists post-login (no trailing slash).
 * Falls back to `https://flow.langwatch.ai`, the same fallback the CLI uses
 * client-side, so the round-trip self-hosted experience stays consistent.
 */
function controlPlaneBaseUrlOf(flow: CliDeviceFlowCollaborators): string {
  return (flow.publicBaseUrl() ?? "https://flow.langwatch.ai").replace(/\/+$/, "");
}

/** Where a person opens the approval page. */
function verificationUriOf(flow: CliDeviceFlowCollaborators): string {
  return `${(flow.publicBaseUrl() ?? "http://localhost:5560").replace(/\/+$/, "")}/cli/auth`;
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

/** Each directory read's own not-found code, and nothing else. */
function isPersonOrOrganizationGone(error: unknown): boolean {
  return (
    HandledError.isHandled(error) &&
    (error.code === "user_not_found" || error.code === "organization_not_found")
  );
}

function isProjectGone(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "project_not_found";
}

/** One OAuth refusal, in the two-field shape RFC 8628 clients parse. */
function refused(error: string, description: string, status: number): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error, error_description: description },
    httpStatus: status,
  });
}

/** A JSON body this family writes itself, exactly as its clients read it. */
function answer(body: unknown): CliDeviceFlowAnswer {
  return { status: 200, body };
}

async function startDeviceFlow({
  flow,
  raw,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
}): Promise<CliDeviceFlowAnswer> {
  const parsed = deviceCodeRequestSchema.safeParse(posted(raw));

  if (!parsed.success) {
    throw refused("invalid_request", parsed.error.issues[0]?.message ?? "invalid body", 400);
  }

  const record = await flow.sessions().startDeviceCode({
    credentialType: parsed.data.credential_type,
  });
  const verificationUri = verificationUriOf(flow);

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
  flow,
  input,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  input: zodModule.infer<typeof lookupQuerySchema>;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  if (!input.user_code) throw refused("invalid_request", "user_code is required", 400);

  const record = await flow.sessions().getDeviceCodeByUserCode({
    userCode: input.user_code,
    unknownDescription: "Code not recognised — it may have expired",
  });

  if (expired(record)) {
    throw refused("expired", "Code has expired — restart `langwatch login`", 410);
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
  flow,
  raw,
  headers,
}: {
  flow: CliDeviceFlowCollaborators;
  raw: string;
  headers: Headers;
}): Promise<CliDeviceFlowAnswer> {
  const person = await flow.session(headers);

  if (!person) throw refused("unauthorized", "Sign in to continue", 401);

  const parsed = denyRequestSchema.safeParse(posted(raw));

  if (!parsed.success) throw refused("invalid_request", "user_code is required", 400);

  await flow.sessions().denyDeviceCodeByUserCode(parsed.data.user_code);

  return answer({ ok: true });
}
