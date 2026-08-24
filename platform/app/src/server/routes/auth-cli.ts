/**
 * CLI device-flow authentication — RFC 8628 OAuth 2.0 Device Authorization
 * Grant.
 *
 * Three endpoints:
 *
 *   POST /api/auth/cli/device-code
 *     Mint a device_code + user_code pair. Returns the verification URI
 *     the CLI must open in the user's browser.
 *
 *   POST /api/auth/cli/exchange
 *     Polled by the CLI with a device_code. Returns access+refresh tokens
 *     once the user has authenticated in the browser; returns 428 / 408 /
 *     410 / 429 in the meantime per RFC 8628 + spec/cli-login.feature.
 *
 *   POST /api/auth/cli/refresh
 *     Trade a refresh_token for a fresh access_token + (rotated) refresh
 *     token. 401 on revoked / unknown — CLI wipes local state on 401.
 *
 * State lives in Redis with the device_code as the key, TTL'd to the
 * device-code lifetime (default 600s). On approval, the browser-side
 * approval handler (see /pages/cli/auth.tsx) flips the status to APPROVED
 * and writes the user/org payload that the next /exchange poll picks up.
 *
 * Wire format is snake_case JSON to match RFC 8628 + every other OAuth
 * library out there (incl. the Go CLI's keyring-backed client).
 */

import { randomBytes } from "node:crypto";
import { ActivityMonitorService } from "@ee/governance/services/activity-monitor/activityMonitor.service";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { AiToolEntryService } from "@ee/governance/services/aiToolEntry.service";
import { CliBootstrapService } from "@ee/governance/services/cliBootstrap.service";
import {
  IngestionKeyService,
  PersonalWorkspaceMissingError,
} from "@ee/governance/services/ingestionKey.service";
import { IngestionTemplateService } from "@ee/governance/services/ingestionTemplate.service";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  PersonalVirtualKeyService,
  RoutingPolicyHasNoProvidersError,
} from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE } from "@ee/governance/services/platformToolPolicy.service";
import { GovernanceSetupStateService } from "@ee/governance/services/setupState.service";
import { createLogger } from "@langwatch/observability";
import type { Context } from "hono";
import { z } from "zod";
import { env } from "~/env.mjs";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
} from "~/server/api/enterprise";
import type { Permission } from "~/server/api/rbac";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  CLI_LOGIN_UNKNOWN_DEVICE_LABEL,
  type CliKeySelection,
  CliLoginKeyService,
} from "~/server/api-key/cli-login-key.service";
import { ApiKeyScopeViolationError } from "~/server/api-key/errors";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import {
  probeOrganizationPermission,
  probeProjectPermission,
} from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import { resolveSupportContact } from "~/server/organizations/resolveSupportContact";

const logger = createLogger("langwatch:auth-cli");

const secured = createServiceApp({ basePath: "/api/auth/cli" });

const CLI_REASON = "CLI device-flow / user session validated in-handler";

// The device flow authenticates the CALLER and gates on no RBAC permission.
const CLI_POLICY = handlerManagedAuth({
  reason: CLI_REASON,
  permissions: [],
  credential: "session",
});
// Routes that DO check a permission once the caller is resolved declare it,
// rather than hiding behind the base policy's empty list.
const cliIngestionSourcesAuth = handlerManagedAuth({
  reason: CLI_REASON,
  permissions: ["ingestionSources:view"],
  credential: "session",
});
const cliActivityMonitorAuth = handlerManagedAuth({
  reason: CLI_REASON,
  permissions: ["activityMonitor:view"],
  credential: "session",
});
// `/approve` mints a credential usable outside the UI, so it requires a
// write-capable project permission — a view-only member cannot extract one.
const cliApproveAuth = handlerManagedAuth({
  reason: CLI_REASON,
  permissions: ["project:update"],
  credential: "session",
});

// ---------------------------------------------------------------------------
// Constants. Defaults match GitHub CLI / gh-style flows; the refresh-token
// idle window is tunable via env for deployments with a stricter policy.
// ---------------------------------------------------------------------------

/**
 * Read a positive-integer override, falling back to `fallback` when unset,
 * unparseable, or non-positive. A typo must not silently produce a session
 * window of zero or NaN seconds.
 */
function positiveIntFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    logger.warn(
      { raw, fallback },
      "ignoring invalid CLI token TTL override; using the default",
    );
    return fallback;
  }
  return parsed;
}

/** Lifetime of an unredeemed device_code, in seconds. */
const DEVICE_CODE_TTL_SECONDS = 600; // 10 min
/** Minimum poll interval the CLI should respect. */
const MIN_POLL_INTERVAL_SECONDS = 5;
/** Access token lifetime. Short; refresh is the rotation path. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90d

/**
 * Refresh token lifetime. Rotated on every refresh, so this is how long a
 * session survives with the CLI sitting idle, not how long the session
 * lasts: each `langwatch <tool>` run that refreshes restarts the window.
 * Someone who points a coding agent at LangWatch and comes back a couple
 * of months later should still be connected, so the idle window is a
 * quarter rather than a month.
 *
 * Shorten it with `LANGWATCH_CLI_REFRESH_TOKEN_TTL_SECONDS` when a stolen
 * `~/.langwatch/config.json` needs to go stale sooner than that. Two other
 * ceilings apply regardless: `Organization.maxSessionDurationDays` caps
 * total session age at /refresh, and revocation takes effect on the next
 * request because `validateAccessToken` reads Redis every time.
 */
const REFRESH_TOKEN_TTL_SECONDS = positiveIntFromEnv(
  process.env.LANGWATCH_CLI_REFRESH_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
);
/** Min seconds between successive /exchange polls per device_code. */
const POLL_RATE_LIMIT_SECONDS = 4;

const DEVICE_CODE_PREFIX = "lwcli:device:"; // Redis key prefix for device-code records
const REFRESH_TOKEN_PREFIX = "lwcli:refresh:"; // Redis key prefix for refresh-token records
const ACCESS_TOKEN_PREFIX = "lwcli:access:"; // Redis key prefix for access-token records
const POLL_RATE_PREFIX = "lwcli:poll:"; // Redis key prefix for poll-rate-limit window

type DeviceCodeStatus = "pending" | "approved" | "denied" | "expired";

/**
 * What the CLI is asking the browser to mint on approval.
 *
 * - `device_session` (default, back-compat): personal VK + access/refresh tokens
 *   for governance-plane CLI use (`langwatch claude`, `whoami`, etc.). Lands in
 *   `~/.langwatch/config.json`.
 * - `project_api_key`: the existing API key of a user-selected project, returned
 *   verbatim so the SDK can use it. Lands in `$CWD/.env` as `LANGWATCH_API_KEY`.
 *   No fresh key is minted; the user picks an existing project they have access
 *   to and the server returns its already-issued `Project.apiKey`.
 *
 * Older CLIs that don't send `credential_type` default to `device_session`.
 */
type CliCredentialType = "device_session" | "project_api_key";

interface DeviceCodeRecord {
  device_code: string;
  user_code: string;
  status: DeviceCodeStatus;
  created_at: number; // unix ms
  expires_at: number; // unix ms
  /** What the CLI is asking the browser to mint. Defaults to `device_session`. */
  credential_type: CliCredentialType;
  /** Set after browser-side approval. */
  user_id?: string;
  organization_id?: string;
  /**
   * Personal VK shipped in the /exchange response. Approval no longer writes
   * it: the field stays readable so a device approved by another instance
   * mid-rollout still resolves.
   */
  personal_vk?: {
    id: string;
    label: string;
    secret: string;
    base_url: string;
  };
  /**
   * For `credential_type: "project_api_key"` after approval — the picked
   * project's existing API key + identifying fields, shipped to the CLI on
   * the next /exchange poll. Mutable across approvals (user can re-pick).
   */
  project_api_key?: {
    project_id: string;
    project_slug: string;
    project_name: string;
    api_key: string;
  };
  /**
   * For `credential_type: "device_session"` after approval — the scope +
   * permission selection the authorize screen approved (or the server-side
   * default when the client sent none). Consumed by /exchange, which mints
   * the user-scoped CLI ApiKey from it. Approval itself mints nothing.
   */
  key_selection?: CliKeySelection;
}

/**
 * Phase 8 — device metadata captured at /exchange time so users can
 * see "Bob's MacBook Pro" entries in the devices inventory and
 * revoke them per-device. All fields optional to stay
 * backwards-compatible with older CLI versions that don't send
 * client_info; rendered as "Unknown device" in the UI when missing.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */
interface ClientInfo {
  /** Human label, defaults to platform + hostname. e.g. "Macbook Pro". */
  device_label?: string;
  /** os.hostname() output. */
  hostname?: string;
  /** os.userInfo().username so we can disambiguate two devs on same Mac. */
  uname?: string;
  /** "darwin" / "linux" / "win32" — process.platform. */
  platform?: string;
  /** First-issued timestamp; preserved across rotations of this session. */
  session_started_at?: number;
}

interface RefreshTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  /** Phase 8 — present when the CLI sent client_info on /exchange. */
  client_info?: ClientInfo;
  /**
   * The user-scoped CLI ApiKey /exchange minted for this session, carried
   * across /refresh rotations so /logout can revoke the key alongside the
   * tokens. Absent for sessions that minted no key.
   */
  cli_api_key_id?: string;
}

interface AccessTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  /** Phase 8 — mirror of refresh-token client_info; useful for the
   * devices inventory, which reads access tokens directly. */
  client_info?: ClientInfo;
  /** Mirror of the refresh-token field; see there. */
  cli_api_key_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an RFC 8628 user_code: 8 chars, dashed in the middle for
 * readability, base32 alphabet excluding ambiguous chars (no I/O/0/1).
 *
 * Example: "WDJB-MJHT"
 */
function generateUserCode(): string {
  // Crockford-ish base32 minus 0/O/I/L/U for unambiguous human entry.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

function generateAccessToken(): string {
  return `lw_at_${randomBytes(32).toString("base64url")}`;
}

function generateRefreshToken(): string {
  return `lw_rt_${randomBytes(32).toString("base64url")}`;
}

function deviceCodeKey(deviceCode: string): string {
  return `${DEVICE_CODE_PREFIX}${deviceCode}`;
}

function userCodeKey(userCode: string): string {
  // Indexed separately so the browser can resolve user_code → device_code
  // when the user pastes the short code instead of clicking the link.
  return `${DEVICE_CODE_PREFIX}usercode:${userCode}`;
}

function refreshTokenKey(refreshToken: string): string {
  return `${REFRESH_TOKEN_PREFIX}${refreshToken}`;
}

function accessTokenKey(accessToken: string): string {
  return `${ACCESS_TOKEN_PREFIX}${accessToken}`;
}

/**
 * Per-user index of CLI token Redis keys, used by
 * `cliTokenRevocation.service.ts` to revoke every token a deactivated
 * user holds. Members are FULL Redis keys (e.g. "lwcli:access:lw_at_AAA")
 * so the revoker can DEL them per-key and stay cluster-safe. The set's
 * own TTL is bumped to the refresh-token lifetime on every mint/rotate
 * so it self-evicts after the longest-lived member would have expired.
 */
function userTokensIndexKey(userId: string): string {
  return `lwcli:user:${userId}:tokens`;
}

/**
 * Resolve a Bearer access_token to its (user_id, organization_id) record.
 * Returns null on missing / expired / malformed. Used by every authenticated
 * CLI endpoint (currently /budget/status; future ones use the same helper).
 *
 * Auth contract: Authorization: Bearer lw_at_<base64url>. Anything else,
 * including session cookies, is rejected — these endpoints are CLI-only.
 */
async function validateAccessToken(
  authHeader: string | null | undefined,
): Promise<AccessTokenRecord | null> {
  const token = bearerAccessToken(authHeader);
  if (!token) return null;
  const redis = getRedis();
  const raw = await redis.get(accessTokenKey(token));
  if (!raw) return null;
  let record: AccessTokenRecord;
  try {
    record = JSON.parse(raw) as AccessTokenRecord;
  } catch {
    return null;
  }
  if (Date.now() > record.expires_at) {
    await redis.del(accessTokenKey(token));
    return null;
  }
  return record;
}

function pollRateKey(deviceCode: string): string {
  return `${POLL_RATE_PREFIX}${deviceCode}`;
}

function getRedis() {
  const redisConnection = tryGetApp()?.redis ?? null;
  if (!redisConnection) {
    throw new Error(
      "Redis connection unavailable — CLI auth requires Redis to be configured (REDIS_URL / REDIS_CLUSTER_ENDPOINTS).",
    );
  }
  return redisConnection;
}

/**
 * The authorization rule every endpoint that hands back a Project.apiKey
 * shares (/approve with a project pick, /project-key): a personal project is
 * honoured only as the caller's OWN explicit pick (the original hazard, per
 * customer report, was a coding agent silently auto-selecting someone's
 * personal project), and because the key is the shared write credential
 * usable outside the UI's RBAC constraints, team membership alone is not
 * enough: the caller needs a write-capable project permission. A view-only
 * member cannot extract it.
 *
 * Returns the refusal response to send, or null when the handout is allowed.
 */
async function refuseProjectKeyHandout(
  c: Context,
  project: { id: string; isPersonal: boolean; ownerUserId: string | null },
  userId: string,
): Promise<Response | null> {
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
  const canWriteProject = await probeProjectPermission(
    {
      session: { user: { id: userId } },
    } as Parameters<typeof probeProjectPermission>[0],
    project.id,
    "project:update",
  );
  if (!canWriteProject) {
    return c.json(
      {
        error: "forbidden",
        error_description:
          "You need write access to this project to retrieve its API key.",
      },
      403,
    );
  }
  return null;
}

/**
 * The one grammar for a CLI bearer access token. Both the validating reader
 * (validateAccessToken) and the raw extraction below share it, so tightening
 * it can never leave a second, more permissive copy behind on the auth
 * boundary.
 */
const BEARER_ACCESS_TOKEN_REGEX = /^Bearer\s+(lw_at_[A-Za-z0-9_\-]+)$/;

/**
 * Extract the Bearer access token from an Authorization header, or null.
 * Kept separate from validateAccessToken so callers that need the raw token
 * string (to revoke it) don't re-run full validation.
 */
function bearerAccessToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader) return null;
  const match = BEARER_ACCESS_TOKEN_REGEX.exec(authHeader.trim());
  return match ? match[1]! : null;
}

/**
 * The tenancy boundary for key-minting CLI endpoints.
 *
 * `validateAccessToken` only proves a Redis token has not expired; it says
 * nothing about whether the user is STILL an active member of the token's
 * organization. A user offboarded after their token was issued must not be
 * able to recreate a personal workspace in the former tenant or pull any
 * project's key. Every endpoint that mints or returns a project API key
 * therefore re-derives current membership from Postgres (the same authority
 * the web RBAC helpers use) before handing anything back.
 *
 * On refusal it also severs the stale session: the presented access token is
 * dropped from Redis (and from the user's token index), so a token minted
 * before removal cannot keep hitting these endpoints. Org-scoped: only the
 * caller's own presented token is revoked, never their sessions in other
 * organizations. Org-wide offboarding still runs
 * CliTokenRevocationService.revokeForUser via user deactivation.
 *
 * Returns a 403 Response to send when the caller is not an active member,
 * or null to proceed.
 *
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
async function ensureActiveOrgMemberOr403(
  c: Context,
  tokenRecord: { user_id: string; organization_id: string },
): Promise<Response | null> {
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: tokenRecord.user_id },
      select: { deactivatedAt: true },
    }),
    // `disabledAt` is part of the predicate: a seat an admin disabled to
    // reclaim it is not an active membership, and the keys minted here are
    // the ones the owner ceiling never reaches — a project key has no owner,
    // and the gateway honours a personal virtual key on its own status. A
    // disabled row reads as no membership, and the session is severed below.
    prisma.organizationUser.findFirst({
      where: {
        userId: tokenRecord.user_id,
        organizationId: tokenRecord.organization_id,
        disabledAt: null,
      },
      select: { userId: true },
    }),
  ]);

  const active = !!user && user.deactivatedAt === null && !!membership;
  if (active) return null;

  // Sever the stale session before refusing: drop the presented access token
  // so the offboarded caller's token stops authenticating immediately.
  const token = bearerAccessToken(c.req.header("Authorization"));
  if (token) {
    try {
      const redis = getRedis();
      await redis.del(accessTokenKey(token));
      await redis.srem(
        userTokensIndexKey(tokenRecord.user_id),
        accessTokenKey(token),
      );
    } catch (err) {
      logger.warn(
        { err, userId: tokenRecord.user_id },
        "[auth-cli] failed to revoke stale access token on membership refusal",
      );
    }
  }

  logger.info(
    {
      userId: tokenRecord.user_id,
      organizationId: tokenRecord.organization_id,
      reason: !user
        ? "user_missing"
        : user.deactivatedAt !== null
          ? "user_deactivated"
          : "not_org_member",
    },
    "[auth-cli] refusing key-minting request from non-active org member; session revoked",
  );

  return c.json(
    {
      error: "forbidden",
      error_description:
        "Your access to this organization has ended. Run `langwatch login` to sign in again.",
    },
    403,
  );
}

/**
 * Control-plane base URL the CLI persists post-login (no trailing slash).
 * Falls back to `https://app.langwatch.ai` when neither `NEXTAUTH_URL` nor
 * `BASE_HOST` is set — same fallback the CLI uses on the client side, so
 * the round-trip self-hosted UX stays consistent.
 */
function controlPlaneBaseUrl(): string {
  const base = env.NEXTAUTH_URL ?? env.BASE_HOST ?? "https://app.langwatch.ai";
  return base.replace(/\/+$/, "");
}

/**
 * Resolve the verification URI a user opens in their browser.
 * Honors `NEXTAUTH_URL` / `BASE_HOST` so this works in dev (localhost),
 * staging, and prod without per-env config.
 */
function verificationUri(): string {
  const base = env.NEXTAUTH_URL ?? env.BASE_HOST ?? "http://localhost:5560";
  return `${base.replace(/\/$/, "")}/cli/auth`;
}

// ---------------------------------------------------------------------------
// POST /api/auth/cli/device-code
// ---------------------------------------------------------------------------
const deviceCodeRequestSchema = z.object({
  // Reserved for future: scope hints (e.g. ["claude_code", "codex"]).
  // Accepted but unused today — every CLI session gets the same scope set.
  scopes: z.array(z.string()).optional(),
  /**
   * What the CLI is asking the browser to mint on approval. Defaults to
   * `device_session` so older CLIs that pre-date the no-paste convergence
   * keep working unchanged (their /exchange response shape is also unchanged).
   */
  credential_type: z
    .enum(["device_session", "project_api_key"])
    .default("device_session"),
});

secured.access(CLI_POLICY).post("/device-code", async (c: Context) => {
  const redis = getRedis();
  const body = await c.req.json().catch(() => ({}));
  const parsed = deviceCodeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        error_description: parsed.error.errors[0]?.message ?? "invalid body",
      },
      400,
    );
  }

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = Date.now();

  const record: DeviceCodeRecord = {
    device_code: deviceCode,
    user_code: userCode,
    status: "pending",
    created_at: now,
    expires_at: now + DEVICE_CODE_TTL_SECONDS * 1000,
    credential_type: parsed.data.credential_type,
  };

  const ttl = DEVICE_CODE_TTL_SECONDS;
  await redis.set(deviceCodeKey(deviceCode), JSON.stringify(record), "EX", ttl);
  // Reverse lookup so the browser can resolve a pasted user_code.
  await redis.set(userCodeKey(userCode), deviceCode, "EX", ttl);

  return c.json(
    {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri(),
      verification_uri_complete: `${verificationUri()}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: MIN_POLL_INTERVAL_SECONDS,
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/exchange
// ---------------------------------------------------------------------------
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
   * Phase 8 — optional device fingerprint. CLI clients SHOULD send
   * `{ hostname: os.hostname(), uname: os.userInfo().username,
   *    platform: process.platform, device_label: <user-set> }`.
   * Older CLI builds that don't send it get rendered as
   * "Unknown device" in the devices inventory; new builds get a friendly
   * label.
   */
  client_info: clientInfoSchema,
});

secured.access(CLI_POLICY).post("/exchange", async (c: Context) => {
  const redis = getRedis();
  const body = await c.req.json().catch(() => ({}));
  const parsed = exchangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "device_code is required",
      },
      400,
    );
  }

  const { device_code } = parsed.data;

  // Per-device polling rate-limit. RFC 8628 says clients respect the
  // server-issued interval but defensive servers must enforce it too.
  // We use SET NX EX — first call writes the key with TTL, subsequent
  // calls within window see existing key and get rejected.
  const setResult = await redis.set(
    pollRateKey(device_code),
    "1",
    "EX",
    POLL_RATE_LIMIT_SECONDS,
    "NX",
  );
  if (setResult !== "OK") {
    return c.json(
      {
        error: "slow_down",
        error_description:
          "Polling too fast. Increase your interval before retrying.",
      },
      429,
    );
  }

  const raw = await redis.get(deviceCodeKey(device_code));
  if (!raw) {
    // Either the device_code never existed or it expired and Redis evicted it.
    // RFC 8628 recommends `expired_token` here.
    return c.json(
      {
        error: "expired_token",
        error_description: "Device code expired or unknown",
      },
      408,
    );
  }

  const record = JSON.parse(raw) as DeviceCodeRecord;

  // Server-side TTL check in case Redis hasn't evicted yet.
  if (Date.now() > record.expires_at) {
    // Per-key dels — Redis cluster CROSSSLOT-rejects multi-key ops
    // when keys differ in hash slot.
    await redis.del(deviceCodeKey(device_code));
    await redis.del(userCodeKey(record.user_code));
    return c.json(
      { error: "expired_token", error_description: "Device code expired" },
      408,
    );
  }

  if (record.status === "denied") {
    // Per-key dels — Redis cluster CROSSSLOT-rejects multi-key ops
    // when keys differ in hash slot.
    await redis.del(deviceCodeKey(device_code));
    await redis.del(userCodeKey(record.user_code));
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

  if (record.status === "approved") {
    if (!record.user_id || !record.organization_id) {
      // Should not happen — approval handler always populates these. Treat
      // as a transient pending state so the CLI keeps polling rather than
      // crashing. Worst case the user re-runs `langwatch login`.
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

    // Look up user + org details for the response payload. We only fetch
    // the fields the CLI actually needs to print on success.
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
        {
          error: "server_error",
          error_description: "User or organization no longer exists",
        },
        500,
      );
    }

    // Membership is re-derived HERE, not trusted from approval time: an admin
    // can disable the seat between approve and exchange, and both branches
    // below hand out credentials the owner ceiling never reaches (a project
    // key has no owner; a device session mints keys of its own). Refused,
    // the device code is consumed so the CLI stops polling for a session it
    // will never get.
    const activeMembership = await prisma.organizationUser.findFirst({
      where: {
        userId: user.id,
        organizationId: organization.id,
        disabledAt: null,
      },
      select: { userId: true },
    });
    if (!activeMembership) {
      await redis.del(deviceCodeKey(device_code));
      await redis.del(userCodeKey(record.user_code));
      return c.json(
        {
          error: "access_denied",
          error_description: "Not an active member of the organization",
        },
        403,
      );
    }

    const responseEndpoint = controlPlaneBaseUrl();

    // No-paste API-key flow: the user picked a project on /cli/auth and the
    // approve handler stamped the project's existing apiKey onto the record.
    // Return the verbatim apiKey + project identity; CLI writes it to .env.
    // No access/refresh tokens needed — the apiKey IS the credential the
    // SDK uses, and it's already revocable from /settings/projects.
    if ((record.credential_type ?? "device_session") === "project_api_key") {
      if (!record.project_api_key) {
        logger.warn(
          `[auth-cli] approved project_api_key device_code ${device_code} missing project payload — returning pending`,
        );
        return c.json(
          {
            error: "authorization_pending",
            error_description:
              "Approval received but project key not ready yet",
          },
          428,
        );
      }
      // Single-use device_code: delete after successful exchange. Per-key
      // dels — Redis cluster CROSSSLOT-rejects multi-key ops on differing
      // hash slots.
      await redis.del(deviceCodeKey(device_code));
      await redis.del(userCodeKey(record.user_code));
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

    // Personal VK is optional on the device session: orgs that haven't
    // published a default RoutingPolicy yet (fresh signup, solo dev,
    // dogfood account) can still sign the user in for governance / portal
    // navigation. The CLI wrapper mints a VK lazily on first gateway call
    // once a provider chain becomes available.

    // Personal project delivery: the personal project is a normal project
    // with a normal apiKey, and it is what data commands (`langwatch trace
    // search`, `/api/me/usage`, ...) authenticate with after a device
    // login. Ensure the workspace here (idempotent; approve may have
    // skipped VK minting for provider-less orgs) and ship its key so the
    // CLI never has to ask the user for one. Best-effort: a workspace
    // failure must not fail the login itself, and older CLIs ignore the
    // extra field.
    let personalProject:
      | { id: string; slug: string; name: string; api_key: string }
      | undefined;
    try {
      const workspace = await new PersonalWorkspaceService(prisma).ensure({
        userId: user.id,
        organizationId: organization.id,
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

    // User-scoped CLI ApiKey — minted HERE, from the selection approval
    // stamped, so an approval that is never exchanged mints nothing. Minted
    // before the session tokens: a mint failure fails the whole exchange
    // (handled error via onError) rather than leaving a half-logged-in CLI
    // holding tokens but no key. Re-login from the same device label revokes
    // the previous login key inside the service, so logins never accumulate
    // credentials.
    let cliApiKey: string | undefined;
    let cliApiKeyId: string | undefined;
    let cliApiKeyScope:
      | { kind: "organization" | "projects"; project_ids: string[] }
      | undefined;
    if (record.key_selection) {
      // Same normalization the other label paths use, and the user-chosen
      // label wins over the machine hostname. The value names the key AND
      // matches the previous login key for replacement, so an unnormalized
      // value would leave the old key alive on a hostname or formatting
      // change and let credentials accumulate.
      const deviceLabel =
        sanitizeDeviceLabel(
          parsed.data.client_info?.device_label ??
            parsed.data.client_info?.hostname,
        ) ?? CLI_LOGIN_UNKNOWN_DEVICE_LABEL;
      let minted: Awaited<
        ReturnType<CliLoginKeyService["mintForDeviceSession"]>
      >;
      try {
        minted = await CliLoginKeyService.create(prisma).mintForDeviceSession({
          userId: user.id,
          organizationId: organization.id,
          deviceLabel,
          selection: record.key_selection,
        });
      } catch (err) {
        // A ceiling refusal is permanent: the selection was approved minutes
        // ago and the approver has lost access since, so every later poll
        // would refuse again. The CLI treats a non-200 as "keep polling", so
        // leaving the record approved for its remaining TTL means one full
        // ceiling walk every 4 seconds with no terminal error on screen.
        // Burn the device code and answer with the one code the CLI already
        // treats as fatal.
        if (ApiKeyScopeViolationError.is(err)) {
          logger.warn(
            { err, userId: user.id, organizationId: organization.id },
            "[auth-cli] CLI login key refused at exchange; terminating the device code",
          );
          await redis.del(deviceCodeKey(device_code));
          await redis.del(userCodeKey(record.user_code));
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
      cliApiKeyScope = {
        kind: minted.scope.kind,
        project_ids: minted.scope.projectIds,
      };
    }

    // Mint access + refresh tokens, persist both in Redis with TTL so
    // protected CLI endpoints (/budget/status etc.) can validate Bearer
    // tokens against an authoritative store.
    const accessToken = generateAccessToken();
    const refreshToken = generateRefreshToken();
    const now = Date.now();
    // Phase 8 — stamp client device info so the devices inventory can show
    // "Bob's MacBook Pro" entries. session_started_at is preserved
    // through future /refresh rotations so the dashboard can show
    // "logged in 5 days ago" rather than the rotation timestamp.
    const clientInfoStamped: ClientInfo | undefined = parsed.data.client_info
      ? { ...parsed.data.client_info, session_started_at: now }
      : undefined;
    const accessRecord: AccessTokenRecord = {
      user_id: user.id,
      organization_id: organization.id,
      issued_at: now,
      expires_at: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
      client_info: clientInfoStamped,
      cli_api_key_id: cliApiKeyId,
    };
    const refreshRecord: RefreshTokenRecord = {
      user_id: user.id,
      organization_id: organization.id,
      issued_at: now,
      expires_at: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      client_info: clientInfoStamped,
      cli_api_key_id: cliApiKeyId,
    };
    // Per-key sets — Redis cluster CROSSSLOT-rejects multi-key ops
    // when keys differ in hash slot. The two records can briefly diverge
    // (e.g. access set but refresh not yet) — that's acceptable: the
    // browser path only reads access; refresh exchange goes back through
    // this same handler if access expires.
    await redis.set(
      accessTokenKey(accessToken),
      JSON.stringify(accessRecord),
      "EX",
      ACCESS_TOKEN_TTL_SECONDS,
    );
    await redis.set(
      refreshTokenKey(refreshToken),
      JSON.stringify(refreshRecord),
      "EX",
      REFRESH_TOKEN_TTL_SECONDS,
    );

    // Per-user token index — single-key ops, cluster-safe. Used by
    // CliTokenRevocationService.revokeForUser on deactivation.
    const indexKey = userTokensIndexKey(user.id);
    await redis
      .pipeline()
      .sadd(
        indexKey,
        accessTokenKey(accessToken),
        refreshTokenKey(refreshToken),
      )
      .pexpire(indexKey, REFRESH_TOKEN_TTL_SECONDS * 1000)
      .exec();

    // Single-use device_code: delete after successful exchange.
    // Per-key dels — Redis cluster CROSSSLOT-rejects multi-key ops
    // when keys differ in hash slot.
    await redis.del(deviceCodeKey(device_code));
    await redis.del(userCodeKey(record.user_code));

    return c.json(
      {
        kind: "device_session" as const,
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        default_personal_vk: record.personal_vk,
        personal_project: personalProject,
        // The user-scoped key + its reach summary. Additive: an older CLI
        // ignores both and keeps using personal_project exactly as before.
        ...(cliApiKey && cliApiKeyScope
          ? { cli_api_key: cliApiKey, cli_api_key_scope: cliApiKeyScope }
          : {}),
        endpoint: responseEndpoint,
      },
      200,
    );
  }

  if (record.status === "expired") {
    return c.json(
      { error: "expired_token", error_description: "Device code expired" },
      408,
    );
  }

  // Defensive: unrecognised status.
  return c.json(
    { error: "server_error", error_description: "Unknown device code state" },
    500,
  );
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/refresh
// ---------------------------------------------------------------------------
const refreshRequestSchema = z.object({
  refresh_token: z.string().min(1),
});

secured.access(CLI_POLICY).post("/refresh", async (c: Context) => {
  const redis = getRedis();
  const body = await c.req.json().catch(() => ({}));
  const parsed = refreshRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "refresh_token is required",
      },
      400,
    );
  }

  const { refresh_token } = parsed.data;
  const raw = await redis.get(refreshTokenKey(refresh_token));
  if (!raw) {
    // Unknown / revoked. CLI wipes local state on 401.
    return c.json(
      {
        error: "invalid_grant",
        error_description: "Refresh token is invalid or revoked",
      },
      401,
    );
  }

  const record = JSON.parse(raw) as RefreshTokenRecord;
  if (Date.now() > record.expires_at) {
    await redis.del(refreshTokenKey(refresh_token));
    return c.json(
      {
        error: "invalid_grant",
        error_description: "Refresh token has expired",
      },
      401,
    );
  }

  // Phase 8 — enforce admin-configured max session duration. The
  // session-start anchor is `client_info.session_started_at` (set at
  // /exchange and preserved across rotations); fall back to
  // record.issued_at for sessions started before client_info was
  // captured. When maxSessionDurationDays > 0 and the session is
  // older, reject the refresh — the user must re-run `langwatch login`.
  const sessionAnchorMs =
    record.client_info?.session_started_at ?? record.issued_at;
  const org = await prisma.organization.findUnique({
    where: { id: record.organization_id },
    select: { maxSessionDurationDays: true },
  });
  const maxDurationDays = org?.maxSessionDurationDays ?? 0;
  if (maxDurationDays > 0) {
    const sessionAgeMs = Date.now() - sessionAnchorMs;
    const maxDurationMs = maxDurationDays * 24 * 60 * 60 * 1000;
    if (sessionAgeMs > maxDurationMs) {
      // Reject + invalidate the old refresh token to prevent further
      // rotation attempts. The CLI gets 401 → wipes local state.
      await redis.del(refreshTokenKey(refresh_token));
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

  // Rotate: mint new pair, invalidate old. (Sliding-window rotation —
  // standard OAuth pattern, helps detect stolen tokens.)
  const newAccessToken = generateAccessToken();
  const newRefreshToken = generateRefreshToken();
  const now = Date.now();
  // Preserve session_started_at across rotations so the devices inventory can
  // accurately show "logged in N days ago" even after many refreshes.
  const carriedClientInfo = record.client_info;
  const newAccessRecord: AccessTokenRecord = {
    user_id: record.user_id,
    organization_id: record.organization_id,
    issued_at: now,
    expires_at: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    client_info: carriedClientInfo,
    // Carried across rotations so /logout can still revoke the CLI key
    // this session minted at /exchange.
    cli_api_key_id: record.cli_api_key_id,
  };
  const newRefreshRecord: RefreshTokenRecord = {
    user_id: record.user_id,
    organization_id: record.organization_id,
    issued_at: now,
    expires_at: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
    client_info: carriedClientInfo,
    cli_api_key_id: record.cli_api_key_id,
  };

  await redis
    .multi()
    .set(
      accessTokenKey(newAccessToken),
      JSON.stringify(newAccessRecord),
      "EX",
      ACCESS_TOKEN_TTL_SECONDS,
    )
    .set(
      refreshTokenKey(newRefreshToken),
      JSON.stringify(newRefreshRecord),
      "EX",
      REFRESH_TOKEN_TTL_SECONDS,
    )
    .del(refreshTokenKey(refresh_token))
    .exec();

  // Refresh the per-user index so revokeForUser sees the rotated pair.
  // The old refresh-token key was DELed in the multi above; leaving it
  // in the index is harmless (DEL on a missing key is a 0-return no-op).
  // The old access-token key TTLs out on its own; same harmlessness.
  // Single-key ops, cluster-safe.
  const indexKey = userTokensIndexKey(record.user_id);
  await redis
    .pipeline()
    .sadd(
      indexKey,
      accessTokenKey(newAccessToken),
      refreshTokenKey(newRefreshToken),
    )
    .pexpire(indexKey, REFRESH_TOKEN_TTL_SECONDS * 1000)
    .exec();

  return c.json(
    {
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: newRefreshToken,
      refresh_expires_in: REFRESH_TOKEN_TTL_SECONDS,
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /api/auth/cli/budget/status
// ---------------------------------------------------------------------------
// Pre-flight check called by `langwatch claude` / `codex` / `cursor` /
// `gemini` before exec'ing the underlying tool. Lets the wrapper render
// the spec-canonical Screen-8 budget-exceeded box (spec:
// specs/ai-gateway/governance/budget-exceeded.feature) without making
// any real LLM calls.
//
// Auth: Authorization: Bearer lw_at_<base64url> (CLI access token).
//
// Responses (per docs/ai-gateway/governance/cli-reference.mdx
// "Budget pre-check (graceful degradation)"):
//   200 {ok: true}                    — no applicable budget exhausted
//   401 {error: ...}                  — invalid / missing access token
//   402 {error: {type: budget_exceeded, ...}} — at least one is at hard_block
//
// Implementation note: we delegate budget evaluation to the existing
// GatewayBudgetService.check() with projectedCost=0 — same code path
// the gateway uses at request time, just without committing spend. If
// ClickHouse isn't configured (smaller self-hosters), we fall back to
// 200 because we have no spend data; the gateway itself will surface
// the actual block at request time via the same code path.
// ---------------------------------------------------------------------------
function requestIncreaseUrl(opts: {
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
}): string {
  const base = env.NEXTAUTH_URL ?? env.BASE_HOST ?? "http://localhost:5560";
  const params = new URLSearchParams({
    scope: opts.scope,
    scope_id: opts.scopeId,
    limit_usd: opts.limitUsd,
    spent_usd: opts.spentUsd,
  });
  return `${base.replace(/\/$/, "")}/me/budget/request?${params.toString()}`;
}

secured.access(CLI_POLICY).get("/budget/status", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }

  // Resolve the user's personal workspace (team + project). If none
  // exists yet (first login, hasn't activated the CLI), nothing can be
  // over budget — return 200 and let the wrapper exec normally.
  const workspaceService = new PersonalWorkspaceService(prisma);
  const workspace = await workspaceService.findExisting({
    userId: tokenRecord.user_id,
    organizationId: tokenRecord.organization_id,
  });
  if (!workspace) return c.json({ ok: true }, 200);

  // Resolve the user's personal VK. Same graceful-fallback rationale —
  // no VK means no traffic flowing, nothing to block on.
  const vkService = PersonalVirtualKeyService.create(prisma);
  const vks = await vkService.list({
    userId: tokenRecord.user_id,
    organizationId: tokenRecord.organization_id,
  });
  const personalVk = vks[0];
  if (!personalVk) return c.json({ ok: true }, 200);

  const budgetService = GatewayBudgetService.create(
    prisma,
    getApp().gateway.budgets,
  );
  const decision = await budgetService.check({
    organizationId: tokenRecord.organization_id,
    teamId: workspace.team.id,
    projectId: workspace.project.id,
    virtualKeyId: personalVk.id,
    principalUserId: tokenRecord.user_id,
    projectedCostUsd: 0,
  });

  if (decision.decision !== "hard_block" || decision.blockedBy.length === 0) {
    return c.json({ ok: true }, 200);
  }

  // Pick the most-restrictive blocker. The check() result orders by
  // strictness; first entry is the binding one.
  const blocker = decision.blockedBy[0]!;
  const adminEmail = await resolveSupportContact({
    prisma,
    organizationId: tokenRecord.organization_id,
  });

  return c.json(
    {
      error: {
        type: "budget_exceeded",
        scope: blocker.scope.toLowerCase(),
        limit_usd: blocker.limitUsd,
        spent_usd: blocker.spentUsd,
        period: blocker.window.toLowerCase(),
        request_increase_url: requestIncreaseUrl({
          scope: blocker.scope.toLowerCase(),
          scopeId: blocker.scopeId,
          limitUsd: blocker.limitUsd,
          spentUsd: blocker.spentUsd,
        }),
        admin_email: adminEmail,
      },
    },
    402,
  );
});

// ---------------------------------------------------------------------------
// CLI bootstrap — Storyboard Screen 4 login-completion ceremony data.
// Returns inherited providers + monthly budget. Wire shape matches
// the tRPC `api.user.cliBootstrap` procedure byte-for-byte (both
// surfaces share CliBootstrapService) so typescript-sdk's
// formatLoginCeremony renders identically regardless of path.
// ---------------------------------------------------------------------------

secured.access(CLI_POLICY).get("/bootstrap", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  const service = CliBootstrapService.create({
    prisma,
    budgetRepository: getApp().gateway.budgets,
  });
  const result = await service.resolve({
    userId: tokenRecord.user_id,
    organizationId: tokenRecord.organization_id,
  });
  return c.json(result, 200);
});

// ---------------------------------------------------------------------------
// GET /api/auth/cli/budget-overview
// ---------------------------------------------------------------------------
// Every budget that binds the caller's own keys, labelled per scope, for
// the `langwatch login` epilogue. Wire shape matches the tRPC
// `api.user.budgetOverview` procedure byte-for-byte (both surfaces share
// BudgetOverviewService), replacing the collapsed single number the
// /bootstrap `budget` field carries for older CLIs.
// ---------------------------------------------------------------------------

secured.access(CLI_POLICY).get("/budget-overview", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  const service = BudgetOverviewService.create(
    prisma,
    getApp().gateway.budgets,
  );
  const result = await service.overviewForUser({
    userId: tokenRecord.user_id,
    organizationId: tokenRecord.organization_id,
  });
  return c.json(result, 200);
});

// ---------------------------------------------------------------------------
// GET /api/auth/cli/personal-project
// ---------------------------------------------------------------------------
// Lazy personal-key exchange for device sessions minted before /exchange
// started shipping `personal_project`. The CLI calls this once with its
// bearer token, persists the key into ~/.langwatch/config.json, and never
// asks again. Ensures the workspace (idempotent) so sessions approved via
// the provider-less branch, which skips VK minting, still resolve a key.
//
// Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
// ---------------------------------------------------------------------------
secured.access(CLI_POLICY).get("/personal-project", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  // Tenancy boundary: prove current, active org membership BEFORE ensure(),
  // which would otherwise recreate a personal workspace in a former tenant
  // and hand out its key to an offboarded user.
  const denied = await ensureActiveOrgMemberOr403(c, tokenRecord);
  if (denied) return denied;

  const user = await prisma.user.findUnique({
    where: { id: tokenRecord.user_id },
    select: { name: true, email: true },
  });
  try {
    const workspace = await new PersonalWorkspaceService(prisma).ensure({
      userId: tokenRecord.user_id,
      organizationId: tokenRecord.organization_id,
      displayName: user?.name,
      displayEmail: user?.email,
    });
    return c.json(
      {
        project: {
          id: workspace.project.id,
          slug: workspace.project.slug,
          name: workspace.project.name,
          api_key: workspace.project.apiKey,
        },
      },
      200,
    );
  } catch (err) {
    logger.error(
      { err, userId: tokenRecord.user_id },
      "[auth-cli] personal-project resolution failed",
    );
    return c.json(
      {
        error: "server_error",
        error_description: "Could not resolve your personal project",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/virtual-key
// ---------------------------------------------------------------------------
// Issues the caller's personal virtual key on demand. This is the only way
// the CLI can obtain one: it calls this the first time a tool resolves to
// gateway mode, so a login that never routes a model call leaves no key
// behind, and a re-login on a machine that already holds one adds nothing.
//
// Body: { device_label? }. The first call for an org returns the "default"
// key. Later calls issue an extra key named after the device, since the
// stored secret is hash-only and cannot be handed out twice.
//
// Returns 201 { id, secret, prefix }. The secret is readable exactly once.
// 409 `no_eligible_providers` when the org has no gateway provider to route
// to: a key minted then would fail on its first request.
//
// Spec: specs/ai-gateway/governance/cli-login.feature
// ---------------------------------------------------------------------------
const issueVirtualKeySchema = z.object({
  device_label: z.string().optional(),
});

/**
 * Reduce a free-form device label to the charset a VK name carries. Returns
 * null when nothing usable survives, so the caller falls back to a random
 * suffix rather than naming every machine the same.
 */
function sanitizeDeviceLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

secured.access(CLI_POLICY).post("/virtual-key", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  // Same tenancy boundary as /personal-project: this mints a credential, so
  // an offboarded user's pre-removal token must not reach it.
  const denied = await ensureActiveOrgMemberOr403(c, tokenRecord);
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const parsed = issueVirtualKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "device_label must be a string",
      },
      400,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: tokenRecord.user_id },
    select: { name: true, email: true },
  });
  const service = PersonalVirtualKeyService.create(prisma);

  try {
    const issued = await issuePersonalVirtualKey({
      service,
      userId: tokenRecord.user_id,
      organizationId: tokenRecord.organization_id,
      displayName: user?.name,
      displayEmail: user?.email,
      deviceLabel: sanitizeDeviceLabel(parsed.data.device_label),
    });
    return c.json(
      {
        id: issued.virtualKey.id,
        secret: issued.secret,
        prefix: issued.virtualKey.displayPrefix,
      },
      201,
    );
  } catch (err) {
    return virtualKeyFailureResponse(c, err, tokenRecord);
  }
});

/**
 * Map a failed personal-VK issuance onto the wire.
 *
 * Both empty-provider causes collapse into one 409: whether the org has no
 * provider at all or pinned a policy holding none, the user's next step is
 * the same, and a key minted anyway would fail on its first request.
 */
function virtualKeyFailureResponse(
  c: Context,
  err: unknown,
  tokenRecord: AccessTokenRecord,
): Response {
  if (
    err instanceof NoEligibleProvidersError ||
    err instanceof RoutingPolicyHasNoProvidersError
  ) {
    logger.info(
      {
        userId: tokenRecord.user_id,
        organizationId: tokenRecord.organization_id,
        reason:
          err instanceof NoEligibleProvidersError
            ? "no_eligible_providers"
            : "routing_policy_has_no_providers",
      },
      "[auth-cli] refusing personal VK: no provider to route to",
    );
    return c.json(
      {
        error: "no_eligible_providers",
        error_description:
          "Your organization has no AI providers configured for the gateway. Ask an admin to add one at Settings → Model Providers.",
      },
      409,
    );
  }
  logger.error(
    { err, userId: tokenRecord.user_id },
    "[auth-cli] personal virtual key issuance failed",
  );
  return c.json(
    {
      error: "server_error",
      error_description: "Could not issue a personal virtual key",
    },
    500,
  );
}

/**
 * Return a usable personal VK for the caller: the org default on the first
 * ask, a device-named key afterwards. `ensureDefault` refuses to re-issue an
 * existing default because its secret is stored hashed, so a second machine
 * needs a key of its own.
 */
async function issuePersonalVirtualKey({
  service,
  userId,
  organizationId,
  displayName,
  displayEmail,
  deviceLabel,
}: {
  service: PersonalVirtualKeyService;
  userId: string;
  organizationId: string;
  displayName?: string | null;
  displayEmail?: string | null;
  deviceLabel: string | null;
}) {
  try {
    return await service.ensureDefault({
      userId,
      organizationId,
      displayName,
      displayEmail,
    });
  } catch (err) {
    if (!(err instanceof PersonalVirtualKeyAlreadyExistsError)) throw err;
  }

  const workspace = await new PersonalWorkspaceService(prisma).ensure({
    userId,
    organizationId,
    displayName,
    displayEmail,
  });
  const suffix = deviceLabel ?? randomBytes(3).toString("hex");
  return await service.issue({
    userId,
    organizationId,
    personalProjectId: workspace.project.id,
    personalTeamId: workspace.team.id,
    label: `device-${suffix}`,
  });
}

// ---------------------------------------------------------------------------
// POST /api/auth/cli/project-key
// ---------------------------------------------------------------------------
// Non-interactive project login: `langwatch login --project <slug>` in a
// headless context (agent VM, CI without a key). The device session proves
// the user; the same RBAC gate as the browser approve flow applies
// (`project:update`, because Project.apiKey is the shared write credential),
// and nothing new is minted, the project's existing key is returned. The
// caller's OWN personal project is allowed, exactly like the authorize page's
// explicit personal pick; anyone else's personal project is refused.
//
// Spec: specs/ai-governance/cli-onboarding/login-unified.feature
// ---------------------------------------------------------------------------
const projectKeyRequestSchema = z.object({
  slug: z.string().min(1),
});

secured.access(CLI_POLICY).post("/project-key", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  // Same tenancy boundary as /personal-project: an offboarded user's
  // pre-removal token must not be able to pull a shared project's key.
  const denied = await ensureActiveOrgMemberOr403(c, tokenRecord);
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const parsed = projectKeyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", error_description: "slug is required" },
      400,
    );
  }
  const project = await prisma.project.findFirst({
    where: {
      slug: parsed.data.slug,
      archivedAt: null,
      team: { organizationId: tokenRecord.organization_id },
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
        error: "not_found",
        error_description: `No project with slug "${parsed.data.slug}" in your organization`,
      },
      404,
    );
  }
  const refusal = await refuseProjectKeyHandout(
    c,
    project,
    tokenRecord.user_id,
  );
  if (refusal) return refusal;
  return c.json(
    {
      api_key: project.apiKey,
      project: { id: project.id, slug: project.slug, name: project.name },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// CLI debug helpers (read-only) — `langwatch ingest *`, `langwatch
// governance status`. Each endpoint validates the device-flow Bearer
// access_token and delegates to the same service classes the web
// admin tRPC procedures call, so the CLI and the UI are guaranteed
// to see the same data — only the wire transport differs (REST here,
// tRPC for the browser; identical service layer underneath).
//
// Authoring (create / rotate / archive) intentionally stays
// browser-only until the setup flow is stable; CLI only reads.
//
// License gate: governance ingestion + activity-monitor surfaces are
// Enterprise-only. Non-enterprise orgs receive a 402 Payment Required
// envelope (RFC 7231 §6.5.2) with the upgrade URL inline so the CLI can
// render an actionable upsell without a follow-up call. Mirrors the
// tRPC `requireEnterprisePlan` middleware shape from
// `platform/app/src/server/api/enterprise.ts` but speaks REST 402 instead
// of TRPCError FORBIDDEN.
// ---------------------------------------------------------------------------

async function ensureEnterpriseOr402(
  c: Context,
  organizationId: string,
  errorMessage: string,
): Promise<Response | null> {
  try {
    await assertEnterprisePlan({ organizationId, errorMessage });
    return null;
  } catch {
    const upgradeUrl = `${
      env.NEXTAUTH_URL ?? env.BASE_HOST ?? "http://localhost:5560"
    }/settings/subscription`;
    return c.json(
      {
        error: "payment_required",
        error_description: errorMessage,
        upgrade_url: upgradeUrl,
      },
      402,
    );
  }
}

// The CLI governance reads mirror web/tRPC surfaces that gate on
// governance RBAC. The bearer token only proves org membership, so without
// this any org member could read sources / activity / status. Enforce the
// same permission the web route requires for the caller's user.
async function ensureGovernancePermissionOr403(
  c: Context,
  tokenRecord: { user_id: string; organization_id: string },
  permission: Permission,
): Promise<Response | null> {
  const allowed = await probeOrganizationPermission(
    { session: { user: { id: tokenRecord.user_id } } } as any,
    tokenRecord.organization_id,
    permission,
  );
  if (allowed) return null;
  return c.json(
    {
      error: "forbidden",
      error_description: `Missing required permission '${permission}' on this organization`,
    },
    403,
  );
}

secured
  .access(cliIngestionSourcesAuth)
  .get("/governance/ingest/sources", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    const gate = await ensureEnterpriseOr402(
      c,
      tokenRecord.organization_id,
      ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
    );
    if (gate) return gate;
    const denied = await ensureGovernancePermissionOr403(
      c,
      tokenRecord,
      "ingestionSources:view",
    );
    if (denied) return denied;
    const includeArchived = c.req.query("include_archived") === "1";
    const service = new IngestionSourceService(prisma);
    const sources = await service.list(tokenRecord.organization_id);
    const filtered = includeArchived
      ? sources
      : sources.filter(
          (s: { archivedAt: Date | null }) => s.archivedAt === null,
        );
    return c.json({
      sources: filtered.map((s: any) => ({
        id: s.id,
        name: s.name,
        sourceType: s.sourceType,
        description: s.description,
        status: s.status,
        lastEventAt: s.lastEventAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        archivedAt: s.archivedAt?.toISOString() ?? null,
      })),
    });
  });

secured
  .access(cliActivityMonitorAuth)
  .get("/governance/ingest/sources/:id/events", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    const gate = await ensureEnterpriseOr402(
      c,
      tokenRecord.organization_id,
      ENTERPRISE_FEATURE_ERRORS.ACTIVITY_MONITOR,
    );
    if (gate) return gate;
    const denied = await ensureGovernancePermissionOr403(
      c,
      tokenRecord,
      "activityMonitor:view",
    );
    if (denied) return denied;
    const sourceId = c.req.param("id");
    if (!sourceId) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "source id is required",
        },
        400,
      );
    }
    const limitRaw = c.req.query("limit");
    const beforeIso = c.req.query("before_iso") ?? undefined;
    const limit = limitRaw
      ? Math.min(Math.max(1, parseInt(limitRaw, 10)), 200)
      : 50;

    // Defensive ownership check before hitting CH — prevents the
    // "querying any source-id with a valid bearer" footgun even
    // though ActivityMonitorService also filters by OrganizationId.
    const sourceService = new IngestionSourceService(prisma);
    const source = await sourceService.findById(
      sourceId,
      tokenRecord.organization_id,
    );
    if (!source) {
      return c.json(
        { error: "not_found", error_description: "IngestionSource not found" },
        404,
      );
    }

    const monitor = new ActivityMonitorService(prisma);
    const events = await monitor.eventsForSource({
      organizationId: tokenRecord.organization_id,
      sourceId,
      limit,
      beforeIso,
    });
    return c.json({ events });
  });

secured
  .access(cliActivityMonitorAuth)
  .get("/governance/ingest/sources/:id/health", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    const gate = await ensureEnterpriseOr402(
      c,
      tokenRecord.organization_id,
      ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
    );
    if (gate) return gate;
    const denied = await ensureGovernancePermissionOr403(
      c,
      tokenRecord,
      "activityMonitor:view",
    );
    if (denied) return denied;
    const sourceId = c.req.param("id");
    if (!sourceId) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "source id is required",
        },
        400,
      );
    }
    const sourceService = new IngestionSourceService(prisma);
    const source = await sourceService.findById(
      sourceId,
      tokenRecord.organization_id,
    );
    if (!source) {
      return c.json(
        { error: "not_found", error_description: "IngestionSource not found" },
        404,
      );
    }
    const monitor = new ActivityMonitorService(prisma);
    const health = await monitor.sourceHealthMetrics({
      organizationId: tokenRecord.organization_id,
      sourceId,
    });
    return c.json({
      source: { id: source.id, name: source.name, status: source.status },
      health,
    });
  });

secured.access(CLI_POLICY).get("/governance/status", async (c: Context) => {
  const tokenRecord = await validateAccessToken(c.req.header("Authorization"));
  if (!tokenRecord) {
    return c.json(
      {
        error: "unauthorized",
        error_description:
          "Bearer access token is missing, malformed, or expired",
      },
      401,
    );
  }
  const gate = await ensureEnterpriseOr402(
    c,
    tokenRecord.organization_id,
    ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
  );
  if (gate) return gate;
  const setupService = GovernanceSetupStateService.create({
    prisma,
    traceActivity: getApp().governance.traceActivity,
  });
  const setup = await setupService.resolve(tokenRecord.organization_id);
  return c.json({ setup });
});

// ---------------------------------------------------------------------------
// Ingestion templates + ingestion keys — device-session adapters.
// ---------------------------------------------------------------------------
// `langwatch <tool>` wrapper-mode (sdks/typescript/.../wrapper-mode.ts) calls
// these from a device-session context (Bearer lw_at_*). The public REST at
// /api/governance/ingestion-templates is mounted under createProjectApp and
// rejects device tokens with 401; these adapter routes resolve
// organizationId+userId from the validated access token and delegate to the
// same services. Wire shape matches what cli-api.ts expects (snake_case
// ingestion_templates), distinct from the project-API-key REST's
// { data: [...] } shape.
// ---------------------------------------------------------------------------

secured
  .access(CLI_POLICY)
  .get("/governance/ingestion-templates", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    const service = IngestionTemplateService.create(prisma);
    const rows = await service.listForUser({
      organizationId: tokenRecord.organization_id,
    });
    return c.json({
      ingestion_templates: rows.map((t) => ({
        id: t.id,
        organization_id: t.organizationId,
        slug: t.slug,
        source_type: t.sourceType,
        display_name: t.displayName,
        description: t.description,
        icon_asset: t.iconAsset,
        credential_schema: t.credentialSchema,
        ottl_rules: t.ottlRules,
        platform_published: t.platformPublished,
        enabled: t.enabled,
      })),
    });
  });

// ---------------------------------------------------------------------------
// POST /api/auth/cli/governance/ingestion-key
// ---------------------------------------------------------------------------
// Mints an ingestion key for the device-session caller. The unified
// `langwatch <tool>` CLI Path B calls this to obtain a write-only `ik-lw-`
// token + the OTLP endpoint, then points the tool's OTLP exporter at it.
// `source_type` carries the tool slug stamped as `langwatch.source`
// provenance.
//
// Body: { source_type, project?, device_label? }.
//
//   - Without `project`: the caller's personal project, rotating in place, so
//     one user never accumulates keys for a tool. Returns
//     { token, prefix, endpoint }.
//   - With `project` (a project id or slug inside the caller's organization):
//     that project, create-only, so two machines instrumenting the same
//     repository each keep a working token. The caller needs `traces:create`
//     on the project. Returns { token, prefix, endpoint, project }.
//
// `endpoint` is `${baseUrl}/api/otel` on both branches.
//
// Both branches refuse with 403 `direct_otel_not_allowed` when the caller's
// organization turned the direct-OTLP path off for the tool `source_type`
// declares. The declaration is what the policy reads, and it is caller-
// controlled, so the check is a backstop for compliant clients (an old CLI,
// a stale cached policy, a hand-run of the documented flow), not an
// isolation boundary: a caller who declares another source type still
// mints, because types outside the wrapped-tool set are a supported input
// here (`copilot_app`, ingestion templates, SDK sources) and a minted key
// carries only the `traces:create` the caller already holds. The receiver
// stamps `langwatch.source` provenance from the key's stored source type,
// so an export sent through a key minted under another tool's name stays
// attributable to that key and the device that minted it.
// ---------------------------------------------------------------------------
const mintIngestionKeySchema = z.object({
  source_type: z.string().min(1),
  /**
   * Project id or slug, resolved inside the caller's organization only. Omit
   * for the caller's personal project.
   */
  project: z.string().min(1).optional(),
  /**
   * Machine this key is for, shown as provenance on the API-keys page. Capped
   * like every other device label the CLI sends, and sanitized before it
   * reaches the key name.
   */
  device_label: z.string().min(1).max(128).optional(),
});

/**
 * Resolve a project the CLI named, as an id first and a slug second, inside
 * one organization. Returns null when nothing matches, which every caller
 * reports as "not found" rather than distinguishing tenants.
 */
async function findProjectInOrg({
  projectRef,
  organizationId,
}: {
  projectRef: string;
  organizationId: string;
}) {
  const select = {
    id: true,
    slug: true,
    name: true,
    isPersonal: true,
    ownerUserId: true,
  } as const;
  const inOrg = { archivedAt: null, team: { organizationId } };
  return (
    (await prisma.project.findFirst({
      where: { id: projectRef, ...inOrg },
      select,
    })) ??
    (await prisma.project.findFirst({
      where: { slug: projectRef, ...inOrg },
      select,
    }))
  );
}

/**
 * The named-project branch of the ingestion-key mint.
 *
 * `projectRef` is read as an id first, then as a slug, and both lookups are
 * confined to the caller's organization: a project in another tenant reports
 * the same `project_not_found` as one that does not exist, so the response
 * never says which ids are real elsewhere. Membership alone does not
 * authorize the mint, the caller needs `traces:create` on the project itself,
 * which is exactly the permission the minted key carries.
 */
async function mintProjectIngestionKey(
  c: Context,
  {
    tokenRecord,
    service,
    projectRef,
    sourceType,
    deviceLabel,
  }: {
    tokenRecord: AccessTokenRecord;
    service: IngestionKeyService;
    projectRef: string;
    sourceType: string;
    deviceLabel: string | null;
  },
): Promise<Response> {
  const project = await findProjectInOrg({
    projectRef,
    organizationId: tokenRecord.organization_id,
  });
  if (!project) {
    return c.json(
      {
        error: "project_not_found",
        error_description: `No project "${projectRef}" in your organization`,
      },
      404,
    );
  }

  // Another user's personal workspace is theirs alone; no permission grant
  // can make a second principal's key into it legitimate.
  if (project.isPersonal && project.ownerUserId !== tokenRecord.user_id) {
    return c.json(
      {
        error: "personal_project_not_allowed",
        error_description:
          "Another user's personal project can't receive your ingestion key. Pick a shared team project, or your own personal workspace.",
      },
      400,
    );
  }

  const allowed = await probeProjectPermission(
    {
      session: { user: { id: tokenRecord.user_id } },
    } as Parameters<typeof probeProjectPermission>[0],
    project.id,
    "traces:create",
  );
  if (!allowed) {
    return c.json(
      {
        error: "forbidden",
        error_description:
          "You need permission to write traces into this project to mint an ingestion key for it.",
      },
      403,
    );
  }

  try {
    const result = await service.issueForProject({
      callerUserId: tokenRecord.user_id,
      // A shared project's key is an org service key, owned by nobody, so it
      // stays visible to the whole team. The caller's own personal workspace
      // is the exception: only its owner may hold a key that reaches it.
      ownerUserId: project.isPersonal ? tokenRecord.user_id : null,
      organizationId: tokenRecord.organization_id,
      projectId: project.id,
      sourceType,
      // The label lands inside the key's display name, so it goes through the
      // same reduction a virtual-key label does rather than reaching the name
      // as free-form text.
      createdByDeviceLabel: sanitizeDeviceLabel(
        deviceLabel ??
          tokenRecord.client_info?.device_label ??
          tokenRecord.client_info?.hostname ??
          undefined,
      ),
    });
    return c.json(
      {
        token: result.token,
        prefix: result.prefix,
        endpoint: `${controlPlaneBaseUrl()}/api/otel`,
        project: { id: project.id, slug: project.slug, name: project.name },
      },
      201,
    );
  } catch (err) {
    logger.error(
      { err, projectId: project.id, sourceType },
      "[auth-cli] project ingestion-key mint failed",
    );
    return c.json(
      {
        error: "server_error",
        error_description: "Could not mint an ingestion key for this project",
      },
      500,
    );
  }
}

secured
  .access(CLI_POLICY)
  .post("/governance/ingestion-key", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    // This mints a credential, so an offboarded caller's pre-removal token
    // must not reach it, the same boundary /virtual-key holds.
    const denied = await ensureActiveOrgMemberOr403(c, tokenRecord);
    if (denied) return denied;

    const parsed = mintIngestionKeySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        {
          error: "invalid_request",
          error_description: parsed.error.message,
        },
        400,
      );
    }
    // Apply the declared tool's direct-OTLP policy: a mint that names a tool
    // the organization turned off is refused, which catches an old CLI, a
    // stale cached policy, or a hand-run of the documented flow. The
    // declaration is trusted; the route docblock states why it cannot be
    // more than that. Only source types a wrapped tool stamps are governed;
    // anything else has no per-tool policy to apply and must stay mintable
    // (`copilot_app`, ingestion templates, SDK sources).
    //
    // `Object.hasOwn` and not a plain lookup: the key is request-controlled,
    // so `"toString"` would otherwise resolve an inherited function, pass a
    // truthy check, and index the policy map with nothing.
    const policedSlug = Object.hasOwn(
      PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
      parsed.data.source_type,
    )
      ? PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE[parsed.data.source_type]
      : undefined;
    if (policedSlug) {
      const policy = await AiToolEntryService.create(prisma).resolveToolPolicy({
        organizationId: tokenRecord.organization_id,
        userId: tokenRecord.user_id,
        slug: policedSlug,
      });
      if (!policy.allowOtelDirect) {
        return c.json(
          {
            error: "direct_otel_not_allowed",
            error_description: `Your organization does not allow ${policedSlug} to send telemetry directly. Run \`langwatch ${policedSlug}\`, which routes through the gateway.`,
          },
          403,
        );
      }
    }

    const service = IngestionKeyService.create(prisma);

    if (parsed.data.project) {
      return await mintProjectIngestionKey(c, {
        tokenRecord,
        service,
        projectRef: parsed.data.project,
        sourceType: parsed.data.source_type,
        deviceLabel: parsed.data.device_label ?? null,
      });
    }

    return await mintPersonalIngestionKey(c, {
      tokenRecord,
      service,
      sourceType: parsed.data.source_type,
    });
  });

/**
 * The personal-project branch of the ingestion-key mint: the caller's own
 * workspace, rotating in place so one user never accumulates keys for a tool.
 */
async function mintPersonalIngestionKey(
  c: Context,
  {
    tokenRecord,
    service,
    sourceType,
  }: {
    tokenRecord: AccessTokenRecord;
    service: IngestionKeyService;
    sourceType: string;
  },
): Promise<Response> {
  try {
    const result = await service.ensureForPersonalProject({
      userId: tokenRecord.user_id,
      organizationId: tokenRecord.organization_id,
      sourceType,
      // Snapshot which device minted the key so the API-keys settings page
      // can attribute it. Falls back to the hostname when the CLI sent no
      // explicit label; null for CLIs that predate device metadata.
      createdByDeviceLabel:
        tokenRecord.client_info?.device_label ??
        tokenRecord.client_info?.hostname ??
        null,
    });
    return c.json(
      {
        token: result.token,
        prefix: result.prefix,
        endpoint: `${controlPlaneBaseUrl()}/api/otel`,
      },
      201,
    );
  } catch (err) {
    // Only the missing workspace is a precondition the caller can fix, so it
    // is the only failure that reports as one. Everything else is a server
    // fault: it gets logged and a fixed message, the way the project branch
    // does, rather than a prompt the user cannot act on and an internal error
    // string on the wire.
    if (err instanceof PersonalWorkspaceMissingError) {
      return c.json(
        {
          error: "precondition_failed",
          error_description:
            "Sign in to a personal workspace before issuing an ingestion key.",
        },
        412,
      );
    }
    logger.error(
      { err, userId: tokenRecord.user_id, sourceType },
      "[auth-cli] personal ingestion-key mint failed",
    );
    return c.json(
      {
        error: "server_error",
        error_description: "Could not mint an ingestion key",
      },
      500,
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/auth/cli/governance/ingestion-keys
// ---------------------------------------------------------------------------
// Returns all live (non-revoked) personal-project ingestion keys for the
// caller's org. The CLI uses this as a cache-liveness preflight (#4755) —
// revoking a key on the platform silently bricks Path B telemetry because
// the wrapper reuses a locally cached token forever. By calling this list
// before reusing a cached key, the wrapper can detect the revocation and
// re-mint rather than repeatedly sending unauthenticated spans.
//
// Response: { keys: [{ source_type, lookup_id, ingestion_template_id }] }
//
// lookup_id is the 16-char identifier embedded in the token prefix
// (`ik-lw-{lookupId}_…`) so the CLI can match the cached token against a
// live server entry without possessing the full secret.
// ---------------------------------------------------------------------------
secured
  .access(CLI_POLICY)
  .get("/governance/ingestion-keys", async (c: Context) => {
    const tokenRecord = await validateAccessToken(
      c.req.header("Authorization"),
    );
    if (!tokenRecord) {
      return c.json(
        {
          error: "unauthorized",
          error_description:
            "Bearer access token is missing, malformed, or expired",
        },
        401,
      );
    }
    const service = IngestionKeyService.create(prisma);
    const keys = await service.listForPersonalProject({
      userId: tokenRecord.user_id,
      organizationId: tokenRecord.organization_id,
    });
    return c.json(
      {
        keys: keys.map((k) => ({
          source_type: k.sourceType,
          lookup_id: k.lookupId,
          ingestion_template_id: k.ingestionTemplateId,
        })),
      },
      200,
    );
  });

// ---------------------------------------------------------------------------
// GET /api/auth/cli/lookup?user_code=XXXX-YYYY
// ---------------------------------------------------------------------------
// Used by the browser-side approval page to surface the device-code
// metadata (originating CLI hostname, request time) before the user
// approves. Session-protected so unauthenticated visitors can't probe
// outstanding device codes.
// ---------------------------------------------------------------------------
secured.access(CLI_POLICY).get("/lookup", async (c: Context) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session?.user) {
    return c.json(
      { error: "unauthorized", error_description: "Sign in to continue" },
      401,
    );
  }
  const userCode = c.req.query("user_code");
  if (!userCode) {
    return c.json(
      { error: "invalid_request", error_description: "user_code is required" },
      400,
    );
  }
  const record = await findDeviceCodeByUserCode(userCode);
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
      // The browser approval page branches its UX on this: `device_session`
      // shows the approve-only flow, `project_api_key` shows a project picker
      // whose key is sent to the CLI. Defaults to device_session for
      // back-compat with records minted before this field existed.
      credential_type: record.credential_type ?? "device_session",
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/approve
// ---------------------------------------------------------------------------
// Called by the browser-side /cli/auth page when the user clicks
// "Approve". Flips the device-code record to `approved`. No credential is
// minted for a device session: the CLI asks for its personal virtual key
// later, through POST /virtual-key. Session-protected.
// ---------------------------------------------------------------------------
const approveRequestSchema = z.object({
  user_code: z.string().min(1),
  organization_id: z.string().min(1),
  /**
   * Required when the device-code's `credential_type` is `project_api_key` —
   * the project the user picked on the browser approval page. Server returns
   * that project's existing API key (no new key is minted; the CLI gets a
   * verbatim copy of `Project.apiKey` for the SDK to consume).
   */
  project_id: z.string().optional(),
  /**
   * For `device_session` approvals — the scope + permission selection the
   * authorize screen collected for the user-scoped CLI key /exchange mints.
   * Optional: a client that sends none gets the server-side default (the
   * widest scope the approving user holds, with the default CLI permission
   * list narrowed to what they hold there).
   */
  key_selection: z
    .object({
      // Bounded at the edge: the ceiling assertion runs one database round
      // per binding per permission, so an unbounded body is a request-thread
      // fan-out that starves the connection pool, and every unrecognised
      // permission is echoed back in the field errors.
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

secured.access(cliApproveAuth).post("/approve", async (c: Context) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session?.user) {
    return c.json(
      { error: "unauthorized", error_description: "Sign in to continue" },
      401,
    );
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

  // Verify the caller is an ACTIVE member of the org they're issuing a key
  // for: a membership an admin disabled to reclaim its seat must not approve
  // a device and hand out a key it could not use itself.
  const membership = await prisma.organizationUser.findFirst({
    where: {
      userId: session.user.id,
      organizationId: organization_id,
      disabledAt: null,
    },
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

  const record = await findDeviceCodeByUserCode(user_code);
  if (!record) {
    return c.json(
      { error: "not_found", error_description: "Code not recognised" },
      404,
    );
  }
  if (Date.now() > record.expires_at) {
    return c.json(
      { error: "expired", error_description: "Code has expired" },
      410,
    );
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
  // `project_api_key` returns the user-picked project's existing apiKey; no
  // new key is minted, so existing consumers (other team members, CI, etc.)
  // keep working unchanged. The CLI writes the key into `$CWD/.env`.
  if ((record.credential_type ?? "device_session") === "project_api_key") {
    if (!project_id) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "project_id is required when credential_type is project_api_key",
        },
        400,
      );
    }
    // Resolve the picked project: it must live in the chosen org and not be
    // archived. Authorization is NOT decided by this lookup. The
    // `probeProjectPermission(..., "project:update")` check below is the source
    // of truth, and it re-derives the org from the project id and inspects
    // project-, team- and org-scoped role bindings plus the org role. So an
    // org-level admin (or an org/team-scoped role-binding admin) who sees the
    // project in the picker via `organization.getAll`, but is not a direct
    // TeamUser member, is authorized by their real permission instead of
    // being pre-filtered out. The org-scoping predicate here plus that RBAC
    // check together stop a spoofed `project_id` from leaking another org's
    // key.
    const project = await prisma.project.findFirst({
      where: {
        id: project_id,
        archivedAt: null,
        team: {
          organizationId: organization_id,
        },
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
          error_description:
            "Project not found or unavailable in this organization",
        },
        403,
      );
    }

    // The browser picker lists personal as a clearly-labelled entry the user
    // must deliberately choose, so an explicit self-pick is honoured here;
    // everything else the shared handout rule refuses.
    const refusal = await refuseProjectKeyHandout(c, project, session.user.id);
    if (refusal) return refusal;

    await approveDeviceCode({
      deviceCode: record.device_code,
      userId: session.user.id,
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

  // Governance gate: the device-session flow provisions a personal
  // workspace (Team + Project) and a personal virtual key for the user.
  // That is a governance-plane capability. The flag defaults on (ADR-038
  // Decision 7: this fallback and the registry default are a pinned
  // pair, enforced by governanceGaDefaults.unit.test.ts), so the gate
  // fires only for orgs whose flag evaluates false (switched off in
  // PostHog or via an operator override), where /me is a 404 and
  // refusing device login is correct. The refusal points at project
  // login, which writes a real project's API key to `.env`; the
  // device-session flow silently capturing evaluations into a personal
  // project (customer report) stays impossible for gated orgs.
  const governanceEnabled = await featureFlagService
    .isEnabled("release_ui_ai_governance_enabled", {
      distinctId: session.user.id,
      organizationId: organization_id,
      defaultValue: true,
    })
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
  // no credential. The personal virtual key is minted later, by POST
  // /virtual-key, and the user-scoped CLI ApiKey is minted by /exchange from
  // the selection stamped here, so an approval that is never exchanged
  // leaves no ApiKey row behind.
  const cliLoginKeys = CliLoginKeyService.create(prisma);
  let keySelection: CliKeySelection | undefined;
  if (parsed.data.key_selection) {
    // Explicit selection from the authorize screen: validated against the
    // registry and the approving user's own ceiling. A violation throws a
    // HandledError (cli_key_selection_invalid / api_key_scope_violation /
    // personal_workspace_not_managed_here) and nothing is stamped.
    keySelection = await cliLoginKeys.validateSelection({
      userId: session.user.id,
      organizationId: organization_id,
      selection: {
        bindings: parsed.data.key_selection.bindings.map((binding) => ({
          scopeType: binding.scope_type,
          scopeId: binding.scope_id,
        })),
        permissions: parsed.data.key_selection.permissions,
      },
    });
  } else {
    // Legacy client (no selection): stamp the server-side default. The
    // personal workspace is ensured first so its team can be part of the
    // default reach — idempotent, and not a credential. Both steps are
    // best-effort: a default that cannot be resolved must not fail the
    // login, it just completes without a scoped key.
    try {
      await new PersonalWorkspaceService(prisma).ensure({
        userId: session.user.id,
        organizationId: organization_id,
        displayName: session.user.name,
        displayEmail: session.user.email,
      });
    } catch (err) {
      logger.warn(
        { err, userId: session.user.id, organizationId: organization_id },
        "[auth-cli] could not ensure personal workspace at approve; default key selection proceeds without it",
      );
    }
    try {
      keySelection =
        (await cliLoginKeys.resolveDefaultSelection({
          userId: session.user.id,
          organizationId: organization_id,
        })) ?? undefined;
    } catch (err) {
      logger.warn(
        { err, userId: session.user.id, organizationId: organization_id },
        "[auth-cli] could not resolve the default key selection; device session proceeds without a scoped key",
      );
    }
  }

  await approveDeviceCode({
    deviceCode: record.device_code,
    userId: session.user.id,
    organizationId: organization_id,
    keySelection,
  });

  return c.json({ ok: true, organization_id }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/deny — user clicked "Deny" on the approval card.
// ---------------------------------------------------------------------------
const denyRequestSchema = z.object({ user_code: z.string().min(1) });

secured.access(CLI_POLICY).post("/deny", async (c: Context) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session?.user) {
    return c.json(
      { error: "unauthorized", error_description: "Sign in to continue" },
      401,
    );
  }
  const body = await c.req.json().catch(() => ({}));
  const parsed = denyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "invalid_request", error_description: "user_code is required" },
      400,
    );
  }
  const record = await findDeviceCodeByUserCode(parsed.data.user_code);
  if (!record) {
    // Idempotent — denying an unknown code is a no-op.
    return c.json({ ok: true });
  }
  await denyDeviceCode(record.device_code);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/logout — revoke access + refresh tokens explicitly.
// CLI uses this in `langwatch logout` so the local config wipe is
// matched by a server-side revocation. Either token may be supplied;
// supplying both kills both immediately. Without the access_token,
// only the refresh is revoked and the access token expires naturally
// in up to 1h — which is a real security gap if the access token was
// stolen, hence the new `access_token` field added alongside refresh.
// Also revokes the user-scoped CLI ApiKey the session's /exchange minted
// (its id rides on the token records), so a logout leaves no live
// credential behind.
// ---------------------------------------------------------------------------
const logoutRequestSchema = z.object({
  refresh_token: z.string().optional(),
  access_token: z.string().optional(),
});

secured.access(CLI_POLICY).post("/logout", async (c: Context) => {
  const redis = getRedis();
  const body = await c.req.json().catch(() => ({}));
  const parsed = logoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    // 200 either way — logout is idempotent and we don't want clients
    // to fail if they pass garbage; just nothing to revoke.
    return c.json({ ok: true });
  }

  // Read the records BEFORE the delete: they carry the id of the CLI ApiKey
  // /exchange minted for this session, which logout revokes alongside the
  // tokens so the wiped config leaves no live credential behind.
  const [refreshRaw, accessRaw] = await Promise.all([
    parsed.data.refresh_token
      ? redis.get(refreshTokenKey(parsed.data.refresh_token))
      : null,
    parsed.data.access_token
      ? redis.get(accessTokenKey(parsed.data.access_token))
      : null,
  ]);

  const ops = redis.multi();
  if (parsed.data.refresh_token) {
    ops.del(refreshTokenKey(parsed.data.refresh_token));
  }
  if (parsed.data.access_token) {
    ops.del(accessTokenKey(parsed.data.access_token));
  }
  await ops.exec();

  await revokeCliKeysFromTokenRecords([refreshRaw, accessRaw]);

  return c.json({ ok: true });
});

/**
 * Revokes the CLI ApiKeys named by a logout's token records. Best-effort and
 * idempotent, like the token deletes beside it: logout stays a 200 whatever
 * state the key is in, and a failed revoke is logged rather than surfaced —
 * the key still dies with the owner's next re-login from the same device.
 */
async function revokeCliKeysFromTokenRecords(
  raws: Array<string | null>,
): Promise<void> {
  const seen = new Set<string>();
  for (const raw of raws) {
    if (!raw) continue;
    let record: RefreshTokenRecord | AccessTokenRecord;
    try {
      record = JSON.parse(raw) as RefreshTokenRecord;
    } catch {
      continue;
    }
    const apiKeyId = record.cli_api_key_id;
    if (!apiKeyId || seen.has(apiKeyId)) continue;
    seen.add(apiKeyId);
    try {
      await CliLoginKeyService.create(prisma).revokeForLogout({
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
}

export const app = secured.hono;

// ---------------------------------------------------------------------------
// Helpers exported for use by the browser-side approval handler
// (alexis lane: src/pages/cli/auth.tsx will import these).
// ---------------------------------------------------------------------------

/**
 * Look up a device-code record by its short user_code (the 8-char form
 * the user types in the browser). Returns null if unknown / expired.
 */
export async function findDeviceCodeByUserCode(
  userCode: string,
): Promise<DeviceCodeRecord | null> {
  const redis = getRedis();
  const deviceCode = await redis.get(userCodeKey(userCode.toUpperCase()));
  if (!deviceCode) return null;
  const raw = await redis.get(deviceCodeKey(deviceCode));
  if (!raw) return null;
  return JSON.parse(raw) as DeviceCodeRecord;
}

/**
 * Approve a device-code session: flips status to `approved` and stamps the
 * user/org payload that the next /exchange poll returns.
 *
 * A `device_session` approval carries no credential. `projectApiKey` is
 * passed only for a `project_api_key` device code, where the browser
 * approval handler has resolved the picked project.
 */
export async function approveDeviceCode({
  deviceCode,
  userId,
  organizationId,
  projectApiKey,
  keySelection,
}: {
  deviceCode: string;
  userId: string;
  organizationId: string;
  projectApiKey?: {
    project_id: string;
    project_slug: string;
    project_name: string;
    api_key: string;
  };
  /**
   * For a `device_session` code — the validated scope + permission selection
   * /exchange mints the user-scoped CLI key from. Stamping it here mints
   * nothing.
   */
  keySelection?: CliKeySelection;
}): Promise<{ approved: boolean }> {
  const redis = getRedis();
  const raw = await redis.get(deviceCodeKey(deviceCode));
  if (!raw) return { approved: false };
  const record = JSON.parse(raw) as DeviceCodeRecord;
  if (Date.now() > record.expires_at) return { approved: false };
  if (record.status !== "pending") return { approved: false };

  const updated: DeviceCodeRecord = {
    ...record,
    status: "approved",
    user_id: userId,
    organization_id: organizationId,
    project_api_key: projectApiKey,
    key_selection: keySelection,
  };

  // Preserve original TTL by computing remaining seconds.
  const remainingMs = Math.max(1000, record.expires_at - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  await redis.set(
    deviceCodeKey(deviceCode),
    JSON.stringify(updated),
    "EX",
    remainingSeconds,
  );
  return { approved: true };
}

/**
 * Deny a device-code session — user clicked "Deny" in the approval UI,
 * or session was rejected by an admin policy.
 */
export async function denyDeviceCode(deviceCode: string): Promise<void> {
  const redis = getRedis();
  const raw = await redis.get(deviceCodeKey(deviceCode));
  if (!raw) return;
  const record = JSON.parse(raw) as DeviceCodeRecord;
  const updated: DeviceCodeRecord = { ...record, status: "denied" };
  const remainingMs = Math.max(1000, record.expires_at - Date.now());
  await redis.set(
    deviceCodeKey(deviceCode),
    JSON.stringify(updated),
    "EX",
    Math.ceil(remainingMs / 1000),
  );
}
