/**
 * The CLI device grant — RFC 8628 OAuth 2.0 Device Authorization Grant — as
 * seven routes under `/api/auth/cli`.
 *
 * The CLI half:
 *
 *   POST /device-code   Mint a device_code + user_code pair and return the
 *                       verification URI the CLI opens in the browser.
 *   POST /exchange      Polled with a device_code. Returns access + refresh
 *                       tokens (or the picked project's key) once the browser
 *                       has approved; 428 / 408 / 410 / 429 in the meantime.
 *   POST /refresh       Trade a refresh_token for a fresh pair. 401 on revoked
 *                       or unknown — the CLI wipes local state on 401.
 *   POST /logout        Revoke either or both halves, and the CLI key the
 *                       session minted. Idempotent.
 *
 * The BROWSER half, which is the grant's "user interaction" step:
 *
 *   GET  /lookup        Resolve a pasted user_code so the approval page can
 *                       show what is being approved.
 *   POST /approve       Flip the code to approved and stamp the identity —
 *                       and, for a project-key grant, the picked project.
 *   POST /deny          Flip it to denied.
 *
 * ## Why all seven are one family
 *
 * They are one state machine over one keyspace. `/device-code` writes the
 * record `/lookup` reads, `/approve` rewrites and `/exchange` consumes; the
 * pair `/exchange` mints is what `/refresh` rotates and `/logout` drops. A
 * split that left four of them writing the device-code keyspace from another
 * package would be two owners of one grammar, and the drift is silent.
 *
 * Everything the flow reaches beyond that keyspace is the PROCESS's and
 * arrives as {@link AuthCliDeviceFlowRestPorts}: the person a browser cookie
 * names, the directory the membership is re-derived from, the credential
 * service that mints and revokes the user-scoped CLI key, the personal
 * workspace a device session ships, and the flag that gates the device
 * journey.
 *
 * Wire format is snake_case JSON to match RFC 8628 and every OAuth client
 * library, including the Go CLI's keyring-backed one.
 *
 * ORDERING: this whole family must be registered BEFORE the `/api/auth/*`
 * catch-all, which swallows every `/auth/*` sibling registered after it.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  ApiKeyScopeViolationError,
  type ApiKeyService,
  type CliKeyScopeSummary,
  type CliKeySelection,
} from "@langwatch/api-key-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { Context } from "hono";
import { z } from "zod";

import {
  DEVICE_CODE_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  type CliClientInfo,
  type CliDeviceSessionService,
} from "../../services/cli-device-session.service";

const logger = createLogger("langwatch:auth-cli");

const CLI_REASON = "CLI device-flow / user session validated in-handler";
const CLI_LOGIN_UNKNOWN_DEVICE_LABEL = "unknown-device";

/**
 * The flag that gates the device-session journey.
 *
 * Declared here rather than imported because this family is the only server
 * surface that reads it; the browser's own holder is a browser module a server
 * package may not reach.
 */
const GOVERNANCE_RELEASE_FLAG = "release_ui_ai_governance_enabled";

/** The personal workspace a device session ships the key of. */
export type CliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string; apiKey: string }>;
}>;

/** Who is signed in, as this process resolves a browser session. */
export type CliBrowserSessionPort = (
  request: Request,
) => Promise<
  Readonly<{ id: string; name?: string | null; email?: string | null }> | null
>;

/** Everything the device grant reaches that it does not itself store. */
export type AuthCliDeviceFlowRestPorts = Readonly<{
  /** The grant's own state: device codes, the poll window, the token pair. */
  sessions: CliDeviceSessionService;
  /**
   * The typed client the identity and membership reads run on.
   *
   * Membership is re-derived from rows rather than trusted from the record: an
   * admin can disable a seat between approve and exchange, and every branch
   * below hands out a credential the owner ceiling never reaches.
   */
  database: () => PrismaClient;
  /** The person a browser cookie names, for the three approval-page routes. */
  session: CliBrowserSessionPort;
  /**
   * The credential service the user-scoped CLI key is minted and revoked
   * through — the SAME one every other door on this process authenticates on.
   */
  apiKeys: () => Pick<
    ApiKeyService,
    | "mintCliLoginKey"
    | "validateCliSelection"
    | "tryResolveDefaultCliSelection"
    | "revokeCliLoginKeyForLogout"
  >;
  /**
   * Resolves — creating if needed — the caller's personal workspace.
   *
   * Idempotent, and not a credential: a device session ships the workspace
   * project's existing key so the CLI never has to ask a person for one.
   */
  ensurePersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }) => Promise<CliPersonalWorkspace>;
  /**
   * Whether one person may write to one project.
   *
   * A port because it is an RBAC decision on the deployment's own AuthZ graph
   * rather than anything the grant knows, and it is the ONE gate standing
   * between a device session and a shared project's write credential.
   */
  canWriteProject: (input: { userId: string; projectId: string }) => Promise<boolean>;
  /** This deployment's flag store, for the device journey's rollout gate. */
  featureFlags: () => Pick<FeatureFlagService, "isEnabled">;
  /**
   * The deployment's public origin, or none.
   *
   * The CLI persists it as the control-plane base URL and the verification URI
   * is built from it. Each falls back the way the route it replaces did — a
   * self-hosted install with neither still round-trips.
   */
  publicBaseUrl?: string | undefined;
}>;

/**
 * Reduce a free-form device label to the charset a key name carries.
 *
 * Returns null when nothing usable survives, so a caller falls back to a
 * random suffix rather than naming every machine the same.
 */
function sanitizeDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

const deviceCodeRequestSchema = z.object({
  // Reserved for future scope hints (e.g. ["claude_code", "codex"]). Accepted
  // but unused today — every CLI session gets the same scope set.
  scopes: z.array(z.string()).optional(),
  /**
   * What the CLI is asking the browser to mint on approval. Defaults to
   * `device_session` so older CLIs that pre-date the no-paste convergence keep
   * working unchanged.
   */
  credential_type: z.enum(["device_session", "project_api_key"]).default("device_session"),
});

const clientInfoSchema = z
  .object({
    device_label: z.string().max(128).optional(),
    hostname: z.string().max(255).optional(),
    uname: z.string().max(64).optional(),
    platform: z.string().max(32).optional(),
  })
  .optional();

const exchangeRequestSchema = z.object({
  device_code: z.string().min(1),
  /**
   * Optional device fingerprint. CLI clients SHOULD send
   * `{ hostname, uname, platform, device_label }`; older builds that send none
   * render as "Unknown device" in the devices inventory.
   */
  client_info: clientInfoSchema,
});

const refreshRequestSchema = z.object({ refresh_token: z.string().min(1) });

const approveRequestSchema = z.object({
  user_code: z.string().min(1),
  organization_id: z.string().min(1),
  /**
   * Required when the device code's `credential_type` is `project_api_key` —
   * the project the user picked. The server returns that project's EXISTING
   * key; no new key is minted.
   */
  project_id: z.string().optional(),
  /**
   * For `device_session` approvals — the scope + permission selection the
   * authorize screen collected. Optional: a client that sends none gets the
   * server-side default.
   */
  key_selection: z
    .object({
      // Bounded at the edge: the ceiling assertion runs one database round per
      // binding per permission, so an unbounded body is a request-thread
      // fan-out that starves the connection pool.
      bindings: z
        .array(
          z.object({
            scope_type: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
            scope_id: z.string().min(1).max(64),
          }),
        )
        .max(200),
      permissions: z.array(z.string().min(1).max(128)).max(500),
    })
    .optional(),
});

const denyRequestSchema = z.object({ user_code: z.string().min(1) });

const logoutRequestSchema = z.object({
  refresh_token: z.string().optional(),
  access_token: z.string().optional(),
});

/** Builds the `/api/auth/cli` device-grant family over one process's ports. */
export function createAuthCliDeviceFlowRestApp(options: {
  security: AppRestSecurity;
  ports: AuthCliDeviceFlowRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/auth/cli" });

  // The device flow authenticates the CALLER and gates on no RBAC permission.
  const cliPolicy = handlerManagedAuth({
    reason: CLI_REASON,
    permissions: [],
    credential: "session",
  });
  // `/approve` mints a credential usable outside the UI, so it requires a
  // write-capable project permission — a view-only member cannot extract one.
  const cliApproveAuth = handlerManagedAuth({
    reason: CLI_REASON,
    permissions: ["project:update"],
    credential: "session",
  });

  /**
   * Control-plane base URL the CLI persists post-login (no trailing slash).
   *
   * Falls back to `https://app.langwatch.ai` when the deployment declared no
   * origin — the same fallback the CLI uses client-side, so the round-trip
   * self-hosted experience stays consistent.
   */
  const controlPlaneBaseUrl = (): string =>
    (ports.publicBaseUrl ?? "https://app.langwatch.ai").replace(/\/+$/, "");

  /** Where a person opens the approval page. */
  const verificationUri = (): string =>
    `${(ports.publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "")}/cli/auth`;

  /**
   * The authorization rule every endpoint that hands back a project's key
   * shares: a personal project is honoured only as the caller's OWN explicit
   * pick (the reported hazard was a coding agent silently auto-selecting
   * someone's personal project), and because the key is the shared write
   * credential usable outside the UI's RBAC constraints, team membership alone
   * is not enough — the caller needs a write-capable project permission. A
   * view-only member cannot extract it.
   *
   * Returns the refusal to send, or null when the handout is allowed.
   */
  const refuseProjectKeyHandout = async (
    c: Context,
    project: { id: string; isPersonal: boolean; ownerUserId: string | null },
    userId: string,
  ): Promise<Response | null> => {
    if (project.isPersonal && project.ownerUserId !== userId) {
      return c.json(
        {
          error: "personal_project_not_allowed",
          error_description:
            "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
        },
        400,
      );
    }
    if (!(await ports.canWriteProject({ userId, projectId: project.id }))) {
      return c.json(
        {
          error: "forbidden",
          error_description: "You need write access to this project to retrieve its API key.",
        },
        403,
      );
    }
    return null;
  };

  // ---------- POST /api/auth/cli/device-code ----------
  secured.access(cliPolicy).post("/device-code", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = deviceCodeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          error_description: parsed.error.issues[0]?.message ?? "invalid body",
        },
        400,
      );
    }

    const record = await ports.sessions.startDeviceCode({
      credentialType: parsed.data.credential_type,
    });

    return c.json(
      {
        device_code: record.device_code,
        user_code: record.user_code,
        verification_uri: verificationUri(),
        verification_uri_complete: `${verificationUri()}?user_code=${encodeURIComponent(
          record.user_code,
        )}`,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: MIN_POLL_INTERVAL_SECONDS,
      },
      200,
    );
  });

  // ---------- POST /api/auth/cli/exchange ----------
  secured.access(cliPolicy).post("/exchange", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = exchangeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", error_description: "device_code is required" },
        400,
      );
    }

    const { device_code } = parsed.data;

    // Per-device polling rate limit, claimed atomically: RFC 8628 says clients
    // respect the server-issued interval, but a defensive server enforces it.
    if (!(await ports.sessions.claimPollWindow(device_code))) {
      return c.json(
        {
          error: "slow_down",
          error_description: "Polling too fast. Increase your interval before retrying.",
        },
        429,
      );
    }

    const record = await ports.sessions.tryFindDeviceCode(device_code);
    if (!record) {
      // Either the device_code never existed or it expired and was evicted.
      // RFC 8628 recommends `expired_token` here.
      return c.json(
        { error: "expired_token", error_description: "Device code expired or unknown" },
        408,
      );
    }

    // Server-side expiry check, in case the store has not evicted yet.
    if (Date.now() > record.expires_at) {
      await ports.sessions.consumeDeviceCode({ record });
      return c.json({ error: "expired_token", error_description: "Device code expired" }, 408);
    }

    if (record.status === "denied") {
      await ports.sessions.consumeDeviceCode({ record });
      return c.json(
        {
          error: "access_denied",
          error_description: "Authorization request was denied by the user",
        },
        410,
      );
    }

    if (record.status === "pending") {
      return c.json(
        {
          error: "authorization_pending",
          error_description: "User has not yet completed authorization",
        },
        428,
      );
    }

    if (record.status === "expired") {
      return c.json({ error: "expired_token", error_description: "Device code expired" }, 408);
    }

    if (record.status !== "approved") {
      // Defensive: an unrecognised status.
      return c.json({ error: "server_error", error_description: "Unknown device code state" }, 500);
    }

    if (!record.user_id || !record.organization_id) {
      // Should not happen — approval always populates these. Treated as a
      // transient pending state so the CLI keeps polling rather than crashing.
      logger.warn(
        `[auth-cli] approved device_code ${device_code} missing user/org payload — returning pending`,
      );
      return c.json(
        {
          error: "authorization_pending",
          error_description: "Approval received but session not ready yet",
        },
        428,
      );
    }

    const prisma = ports.database();
    const user = await prisma.user.findUnique({
      where: { id: record.user_id },
      select: { id: true, email: true, name: true },
    });
    const organization = await prisma.organization.findUnique({
      where: { id: record.organization_id },
      select: { id: true, name: true, slug: true },
    });
    if (!user || !organization) {
      logger.error(
        `[auth-cli] approved device_code refers to missing user (${record.user_id}) or org (${record.organization_id})`,
      );
      return c.json(
        { error: "server_error", error_description: "User or organization no longer exists" },
        500,
      );
    }

    // Membership is re-derived HERE, not trusted from approval time: an admin
    // can disable the seat between approve and exchange, and both branches
    // below hand out credentials the owner ceiling never reaches. Refused, the
    // device code is consumed and the answer is the same fatal 410 the mint
    // below already gives a removed member, so the CLI stops polling for a
    // session it will never get.
    const activeMembership = await prisma.organizationUser.findFirst({
      where: { userId: user.id, organizationId: organization.id, disabledAt: null },
      select: { userId: true },
    });
    if (!activeMembership) {
      await ports.sessions.consumeDeviceCode({ record, alsoPollWindow: true });
      return c.json(
        {
          error: "access_denied",
          error_description: "Not an active member of the organization",
        },
        410,
      );
    }

    const responseEndpoint = controlPlaneBaseUrl();

    // No-paste API-key flow: the user picked a project on the approval page
    // and the approve handler stamped its existing key onto the record. The
    // key IS the credential the SDK uses and is already revocable from the
    // projects settings, so no access/refresh pair is needed.
    if ((record.credential_type ?? "device_session") === "project_api_key") {
      if (!record.project_api_key) {
        logger.warn(
          `[auth-cli] approved project_api_key device_code ${device_code} missing project payload — returning pending`,
        );
        return c.json(
          {
            error: "authorization_pending",
            error_description: "Approval received but project key not ready yet",
          },
          428,
        );
      }
      await ports.sessions.consumeDeviceCode({ record });
      return c.json(
        {
          kind: "api_key" as const,
          api_key: record.project_api_key.api_key,
          project: {
            id: record.project_api_key.project_id,
            slug: record.project_api_key.project_slug,
            name: record.project_api_key.project_name,
          },
          user: { id: user.id, email: user.email, name: user.name },
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          },
          endpoint: responseEndpoint,
        },
        200,
      );
    }

    // Personal project delivery: the personal project is a normal project with
    // a normal key, and it is what data commands authenticate with after a
    // device login. Ensured here (idempotent) so a session approved through
    // the provider-less branch still resolves a key. Best-effort — a workspace
    // failure must not fail the login itself, and older CLIs ignore the field.
    let personalProject:
      | { id: string; slug: string; name: string; api_key: string }
      | undefined;
    try {
      const workspace = await ports.ensurePersonalWorkspace({
        organizationId: organization.id,
        userId: user.id,
        displayName: user.name,
        displayEmail: user.email,
      });
      personalProject = {
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
    }

    // The user-scoped CLI key — minted HERE, from the selection approval
    // stamped, so an approval that is never exchanged mints nothing. Minted
    // BEFORE the session tokens: a mint failure fails the whole exchange
    // rather than leaving a half-logged-in CLI holding tokens but no key.
    let cliApiKey: string | undefined;
    let cliApiKeyId: string | undefined;
    let cliApiKeyScope: { kind: "organization" | "projects"; project_ids: string[] } | undefined;
    if (record.key_selection) {
      // The same normalization every other label path uses, and the
      // user-chosen label wins over the machine hostname. The value names the
      // key AND matches the previous login key for replacement, so an
      // unnormalized value would leave the old key alive on a hostname or
      // formatting change and let credentials accumulate.
      const deviceLabel =
        sanitizeDeviceLabel(
          parsed.data.client_info?.device_label ?? parsed.data.client_info?.hostname,
        ) ?? CLI_LOGIN_UNKNOWN_DEVICE_LABEL;
      let minted: { token: string; apiKeyId: string; scope: CliKeyScopeSummary };
      try {
        minted = await ports.apiKeys().mintCliLoginKey({
          userId: user.id,
          organizationId: organization.id,
          deviceLabel,
          selection: record.key_selection,
        });
      } catch (err) {
        // A ceiling refusal is permanent: the selection was approved minutes
        // ago and the approver has lost access since, so every later poll
        // would refuse again. The CLI treats a non-200 as "keep polling", so
        // leaving the record approved for its remaining lifetime means one
        // full ceiling walk every four seconds with no terminal error on
        // screen. Burn the device code and answer with the one code the CLI
        // already treats as fatal.
        if (ApiKeyScopeViolationError.is(err)) {
          logger.warn(
            { err, userId: user.id, organizationId: organization.id },
            "[auth-cli] CLI login key refused at exchange; terminating the device code",
          );
          await ports.sessions.consumeDeviceCode({ record });
          return c.json(
            {
              error: "access_denied",
              error_description:
                "Your access changed after you approved this login. Run `langwatch login` again.",
            },
            410,
          );
        }
        throw err;
      }
      cliApiKey = minted.token;
      cliApiKeyId = minted.apiKeyId;
      cliApiKeyScope = { kind: minted.scope.kind, project_ids: minted.scope.projectIds };
    }

    // Stamp the device info so the devices inventory can show a recognisable
    // entry. `session_started_at` is preserved through later rotations so the
    // dashboard shows "logged in 5 days ago" rather than the rotation moment.
    const clientInfo: CliClientInfo | undefined = parsed.data.client_info
      ? { ...parsed.data.client_info, session_started_at: Date.now() }
      : undefined;
    const session = await ports.sessions.mintSession({
      userId: user.id,
      organizationId: organization.id,
      clientInfo,
      cliApiKeyId,
    });

    // Single-use device code: consumed after a successful exchange.
    await ports.sessions.consumeDeviceCode({ record });

    return c.json(
      {
        kind: "device_session" as const,
        access_token: session.accessToken,
        token_type: "Bearer" as const,
        expires_in: session.accessTtlSeconds,
        refresh_token: session.refreshToken,
        refresh_expires_in: session.refreshTtlSeconds,
        user: { id: user.id, email: user.email, name: user.name },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        default_personal_vk: record.personal_vk,
        personal_project: personalProject,
        // The user-scoped key and its reach summary. Additive: an older CLI
        // ignores both and keeps using `personal_project` exactly as before.
        ...(cliApiKey && cliApiKeyScope
          ? { cli_api_key: cliApiKey, cli_api_key_scope: cliApiKeyScope }
          : {}),
        endpoint: responseEndpoint,
      },
      200,
    );
  });

  // ---------- POST /api/auth/cli/refresh ----------
  secured.access(cliPolicy).post("/refresh", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = refreshRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", error_description: "refresh_token is required" },
        400,
      );
    }

    const { refresh_token } = parsed.data;
    const record = await ports.sessions.tryFindRefreshToken(refresh_token);
    if (!record) {
      // Unknown or revoked. The CLI wipes local state on 401.
      return c.json(
        { error: "invalid_grant", error_description: "Refresh token is invalid or revoked" },
        401,
      );
    }
    if (Date.now() > record.expires_at) {
      await ports.sessions.dropRefreshToken(refresh_token);
      return c.json(
        { error: "invalid_grant", error_description: "Refresh token has expired" },
        401,
      );
    }

    // Enforce the admin-configured maximum session duration. The anchor is
    // `client_info.session_started_at` (set at exchange and preserved across
    // rotations), falling back to the record's issue time for sessions started
    // before device metadata was captured.
    const prisma = ports.database();
    const sessionAnchorMs = record.client_info?.session_started_at ?? record.issued_at;
    const org = await prisma.organization.findUnique({
      where: { id: record.organization_id },
      select: { maxSessionDurationDays: true },
    });
    const maxDurationDays = org?.maxSessionDurationDays ?? 0;
    if (maxDurationDays > 0) {
      const sessionAgeMs = Date.now() - sessionAnchorMs;
      if (sessionAgeMs > maxDurationDays * 24 * 60 * 60 * 1000) {
        // Reject AND invalidate the old refresh token, so no further rotation
        // is attempted. The CLI gets 401 and wipes local state.
        await ports.sessions.dropRefreshToken(refresh_token);
        logger.info(
          {
            userId: record.user_id,
            organizationId: record.organization_id,
            sessionAgeDays: Math.round(sessionAgeMs / 86_400_000),
            maxDurationDays,
          },
          "rejecting refresh: session exceeded org max-duration policy",
        );
        return c.json(
          {
            error: "invalid_grant",
            error_description: `Session exceeded organization max-duration policy of ${maxDurationDays} days. Please run \`langwatch login\` to start a new session.`,
          },
          401,
        );
      }
    }

    // Rotation mints a new credential pair, so it re-derives membership the
    // way the other minting endpoints do. A bearer-only route still honours
    // the access token already in hand until it expires — one hour, the same
    // window a removed member has; this is what stops that window from rolling
    // forward for a quarter.
    const activeMembership = await prisma.organizationUser.findFirst({
      where: {
        userId: record.user_id,
        organizationId: record.organization_id,
        disabledAt: null,
      },
      select: { userId: true },
    });
    if (!activeMembership) {
      await ports.sessions.dropRefreshToken(refresh_token);
      logger.info(
        { userId: record.user_id, organizationId: record.organization_id },
        "rejecting refresh: caller is not an active member of the organization",
      );
      return c.json(
        {
          error: "invalid_grant",
          error_description:
            "Your access to this organization is no longer active. Please run `langwatch login` to start a new session.",
        },
        401,
      );
    }

    // Sliding-window rotation: mint a new pair, invalidate the old refresh.
    // `session_started_at` and the CLI key id are carried across so the
    // devices inventory keeps its anchor and logout can still revoke the key.
    const rotated = await ports.sessions.mintSession({
      userId: record.user_id,
      organizationId: record.organization_id,
      clientInfo: record.client_info,
      cliApiKeyId: record.cli_api_key_id,
    });
    await ports.sessions.dropRefreshToken(refresh_token);

    return c.json(
      {
        access_token: rotated.accessToken,
        token_type: "Bearer",
        expires_in: rotated.accessTtlSeconds,
        refresh_token: rotated.refreshToken,
        refresh_expires_in: rotated.refreshTtlSeconds,
      },
      200,
    );
  });

  // ---------- GET /api/auth/cli/lookup ----------
  // Read by the browser approval page so it can show what is being approved.
  // Session-protected so an unauthenticated visitor cannot probe outstanding
  // device codes.
  secured.access(cliPolicy).get("/lookup", async (c) => {
    const person = await ports.session(c.req.raw);
    if (!person) {
      return c.json({ error: "unauthorized", error_description: "Sign in to continue" }, 401);
    }
    const userCode = c.req.query("user_code");
    if (!userCode) {
      return c.json({ error: "invalid_request", error_description: "user_code is required" }, 400);
    }
    const record = await ports.sessions.tryFindDeviceCodeByUserCode(userCode);
    if (!record) {
      return c.json(
        {
          error: "not_found",
          error_description: "Code not recognised — it may have expired",
        },
        404,
      );
    }
    if (Date.now() > record.expires_at) {
      return c.json(
        {
          error: "expired",
          error_description: "Code has expired — restart `langwatch login`",
        },
        410,
      );
    }
    return c.json(
      {
        user_code: record.user_code,
        status: record.status,
        created_at: record.created_at,
        expires_at: record.expires_at,
        // The approval page branches its journey on this: `device_session`
        // shows the approve-only flow, `project_api_key` shows a project
        // picker whose key is sent to the CLI. Defaults to device_session for
        // records minted before the field existed.
        credential_type: record.credential_type ?? "device_session",
      },
      200,
    );
  });

  // ---------- POST /api/auth/cli/approve ----------
  secured.access(cliApproveAuth).post("/approve", async (c) => {
    const person = await ports.session(c.req.raw);
    if (!person) {
      return c.json({ error: "unauthorized", error_description: "Sign in to continue" }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = approveRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "user_code and organization_id are required",
        },
        400,
      );
    }
    const { user_code, organization_id, project_id } = parsed.data;

    const prisma = ports.database();
    // Verify the caller is an ACTIVE member of the organization they are
    // issuing a credential for: a membership an admin disabled to reclaim its
    // seat must not approve a device and hand out a key it could not use.
    const membership = await prisma.organizationUser.findFirst({
      where: { userId: person.id, organizationId: organization_id, disabledAt: null },
      select: { userId: true },
    });
    if (!membership) {
      return c.json(
        {
          error: "forbidden",
          error_description: `Not a member of organization ${organization_id}`,
        },
        403,
      );
    }

    const record = await ports.sessions.tryFindDeviceCodeByUserCode(user_code);
    if (!record) {
      return c.json({ error: "not_found", error_description: "Code not recognised" }, 404);
    }
    if (Date.now() > record.expires_at) {
      return c.json({ error: "expired", error_description: "Code has expired" }, 410);
    }
    if (record.status !== "pending") {
      return c.json(
        {
          error: "already_resolved",
          error_description: `Code is in '${record.status}' state — restart langwatch login`,
        },
        409,
      );
    }

    // Branch on the credential type the CLI requested at /device-code time.
    // `project_api_key` returns the picked project's EXISTING key, so other
    // consumers keep working unchanged.
    if ((record.credential_type ?? "device_session") === "project_api_key") {
      if (!project_id) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "project_id is required when credential_type is project_api_key",
          },
          400,
        );
      }
      // Resolve the picked project: it must live in the chosen organization
      // and not be archived. Authorization is NOT decided by this lookup — the
      // write-permission check below is, and it inspects project-, team- and
      // org-scoped bindings. The org-scoping predicate here plus that check
      // together stop a spoofed `project_id` from leaking another org's key.
      const project = await prisma.project.findFirst({
        where: {
          id: project_id,
          archivedAt: null,
          team: { organizationId: organization_id },
        },
        select: {
          id: true,
          slug: true,
          name: true,
          apiKey: true,
          isPersonal: true,
          ownerUserId: true,
        },
      });
      if (!project) {
        return c.json(
          {
            error: "forbidden",
            error_description: "Project not found or unavailable in this organization",
          },
          403,
        );
      }

      // The picker lists personal as a clearly-labelled entry the person must
      // deliberately choose, so an explicit self-pick is honoured here;
      // everything else the shared handout rule refuses.
      const refusal = await refuseProjectKeyHandout(c, project, person.id);
      if (refusal) return refusal;

      await ports.sessions.approveDeviceCode({
        deviceCode: record.device_code,
        userId: person.id,
        organizationId: organization_id,
        projectApiKey: {
          project_id: project.id,
          project_slug: project.slug,
          project_name: project.name,
          api_key: project.apiKey,
        },
      });

      return c.json(
        {
          ok: true,
          kind: "api_key" as const,
          project: { id: project.id, slug: project.slug, name: project.name },
          organization_id,
        },
        200,
      );
    }

    // Governance gate: the device-session flow provisions a personal workspace
    // and a personal virtual key, which is a governance-plane capability. The
    // flag defaults ON, so the gate fires only for organizations whose flag
    // evaluates false — where the governance surfaces are absent and refusing
    // the device login is correct. The refusal points at project login, which
    // writes a real project's key to `.env`.
    const governanceEnabled = await ports
      .featureFlags()
      .isEnabled(GOVERNANCE_RELEASE_FLAG as never, {
        kind: "organization",
        userId: person.id,
        organizationId: organization_id,
      } as never)
      .catch(() => true);
    if (!governanceEnabled) {
      return c.json(
        {
          error: "governance_required",
          error_description:
            "AI-tools (device) login needs governance enabled for your organization. Re-run `langwatch login` and choose project login. It writes a project API key to your .env.",
        },
        403,
      );
    }

    // Approval proves identity and stamps the key SELECTION — it still mints
    // no credential. The personal virtual key is issued later by the
    // governance CLI family, and the user-scoped key by `/exchange` from the
    // selection stamped here, so an approval never exchanged leaves no row.
    let keySelection: CliKeySelection | undefined;
    if (parsed.data.key_selection) {
      // Explicit selection from the authorize screen: validated against the
      // registry and the approving person's own ceiling. A violation throws a
      // handled error and nothing is stamped.
      keySelection = await ports.apiKeys().validateCliSelection({
        userId: person.id,
        organizationId: organization_id,
        selection: {
          bindings: parsed.data.key_selection.bindings.map((binding) => ({
            scopeType: binding.scope_type,
            scopeId: binding.scope_id,
          })),
          permissions: parsed.data.key_selection.permissions,
        } as CliKeySelection,
      });
    } else {
      // Legacy client with no selection: stamp the server-side default. The
      // personal workspace is ensured first so its team can be part of the
      // default reach — idempotent, and not a credential. Both steps are
      // best-effort: a default that cannot be resolved must not fail the
      // login, it just completes without a scoped key.
      try {
        await ports.ensurePersonalWorkspace({
          organizationId: organization_id,
          userId: person.id,
          displayName: person.name,
          displayEmail: person.email,
        });
      } catch (err) {
        logger.warn(
          { err, userId: person.id, organizationId: organization_id },
          "[auth-cli] could not ensure personal workspace at approve; default key selection proceeds without it",
        );
      }
      try {
        keySelection =
          (await ports.apiKeys().tryResolveDefaultCliSelection({
            userId: person.id,
            organizationId: organization_id,
          })) ?? undefined;
      } catch (err) {
        logger.warn(
          { err, userId: person.id, organizationId: organization_id },
          "[auth-cli] could not resolve the default key selection; device session proceeds without a scoped key",
        );
      }
    }

    await ports.sessions.approveDeviceCode({
      deviceCode: record.device_code,
      userId: person.id,
      organizationId: organization_id,
      keySelection,
    });

    return c.json({ ok: true, organization_id }, 200);
  });

  // ---------- POST /api/auth/cli/deny ----------
  secured.access(cliPolicy).post("/deny", async (c) => {
    const person = await ports.session(c.req.raw);
    if (!person) {
      return c.json({ error: "unauthorized", error_description: "Sign in to continue" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = denyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", error_description: "user_code is required" }, 400);
    }
    const record = await ports.sessions.tryFindDeviceCodeByUserCode(parsed.data.user_code);
    // Idempotent — denying an unknown code is a no-op.
    if (!record) return c.json({ ok: true });
    await ports.sessions.denyDeviceCode(record.device_code);
    return c.json({ ok: true });
  });

  // ---------- POST /api/auth/cli/logout ----------
  // Either token may be supplied; supplying both kills both immediately.
  // Without the access token only the refresh is revoked and the access token
  // expires naturally within the hour — a real gap if it was stolen, which is
  // why the field exists. The user-scoped key the session minted is revoked
  // alongside, so a wiped config leaves no live credential behind.
  secured.access(cliPolicy).post("/logout", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = logoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      // 200 either way — logout is idempotent, and a client that sent garbage
      // must not be told its sign-out failed. There is simply nothing to
      // revoke.
      return c.json({ ok: true });
    }

    const records = await ports.sessions.endSession({
      refreshToken: parsed.data.refresh_token,
      accessToken: parsed.data.access_token,
    });

    // Best-effort and idempotent, like the token deletes beside it: logout
    // stays a 200 whatever state the key is in, and a failed revoke is logged
    // rather than surfaced — the key still dies with the owner's next
    // re-login from the same device.
    const seen = new Set<string>();
    for (const record of records) {
      const apiKeyId = record.cli_api_key_id;
      if (!apiKeyId || seen.has(apiKeyId)) continue;
      seen.add(apiKeyId);
      try {
        await ports.apiKeys().revokeCliLoginKeyForLogout({
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

    return c.json({ ok: true });
  });

  return secured.hono;
}
