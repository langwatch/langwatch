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
 * approval handler (see /pages/cli/auth.tsx — alexis lane) flips the
 * status to APPROVED and writes the user/org/personal-VK payload that
 * the next /exchange poll picks up.
 *
 * Wire format is snake_case JSON to match RFC 8628 + every other OAuth
 * library out there (incl. the Go CLI's keyring-backed client).
 */
import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { env } from "~/env.mjs";
import { connection as redisConnection } from "~/server/redis";
import { prisma } from "~/server/db";
import { getServerAuthSession } from "~/server/auth";
import { hasOrganizationPermission, hasProjectPermission } from "~/server/api/rbac";
import type { Permission } from "~/server/api/rbac";
import {
  PersonalVirtualKeyService,
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  RoutingPolicyHasNoProvidersError,
} from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { ActivityMonitorService } from "@ee/governance/services/activity-monitor/activityMonitor.service";
import { GovernanceSetupStateService } from "@ee/governance/services/setupState.service";
import { CliBootstrapService } from "@ee/governance/services/cliBootstrap.service";
import { featureFlagService } from "~/server/featureFlag";
import { IngestionTemplateService } from "@ee/governance/services/ingestionTemplate.service";
import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
} from "~/server/api/enterprise";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { resolveSupportContact } from "~/server/organizations/resolveSupportContact";
import {
  createServiceApp,
  handlerManagedAuth,
} from "~/server/api/security";

const logger = createLogger("langwatch:auth-cli");

const secured = createServiceApp({ basePath: "/api/auth/cli" });

const CLI_POLICY = handlerManagedAuth(
  "CLI device-flow / user session validated in-handler",
);

// ---------------------------------------------------------------------------
// Constants — tunable via env if a customer ever needs longer windows.
// Defaults match GitHub CLI / gh-style flows.
// ---------------------------------------------------------------------------

/** Lifetime of an unredeemed device_code, in seconds. */
const DEVICE_CODE_TTL_SECONDS = 600; // 10 min
/** Minimum poll interval the CLI should respect. */
const MIN_POLL_INTERVAL_SECONDS = 5;
/** Access token lifetime. Short — refresh is the rotation path. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
/** Refresh token lifetime. Long-lived but rotated on every refresh. */
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d
/** Min seconds between successive /exchange polls per device_code. */
const POLL_RATE_LIMIT_SECONDS = 4;

const DEVICE_CODE_PREFIX = "lwcli:device:"; // Redis key prefix for device-code records
const REFRESH_TOKEN_PREFIX = "lwcli:refresh:"; // Redis key prefix for refresh-token records
const ACCESS_TOKEN_PREFIX = "lwcli:access:"; // Redis key prefix for access-token records
const POLL_RATE_PREFIX = "lwcli:poll:"; // Redis key prefix for poll-rate-limit window

type DeviceCodeStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

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
  /** Default personal VK shipped in /exchange response. Created lazily on approval. */
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
}

/**
 * Phase 8 — device metadata captured at /exchange time so users can
 * see "Bob's MacBook Pro" entries in the /me/sessions inventory and
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
}

interface AccessTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  /** Phase 8 — mirror of refresh-token client_info; useful for the
   * /me/sessions UI which reads access tokens directly. */
  client_info?: ClientInfo;
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
  if (!authHeader) return null;
  const match = /^Bearer\s+(lw_at_[A-Za-z0-9_\-]+)$/.exec(authHeader.trim());
  if (!match) return null;
  const token = match[1]!;
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
  if (!redisConnection) {
    throw new Error(
      "Redis connection unavailable — CLI auth requires Redis to be configured (REDIS_URL / REDIS_CLUSTER_ENDPOINTS).",
    );
  }
  return redisConnection;
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
  const base =
    env.NEXTAUTH_URL ?? env.BASE_HOST ?? "http://localhost:5560";
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
   * "Unknown device" in /me/sessions; new builds get a friendly label.
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
      { error: "expired_token", error_description: "Device code expired or unknown" },
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
            error_description: "Approval received but project key not ready yet",
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

    // Mint access + refresh tokens, persist both in Redis with TTL so
    // protected CLI endpoints (/budget/status etc.) can validate Bearer
    // tokens against an authoritative store.
    const accessToken = generateAccessToken();
    const refreshToken = generateRefreshToken();
    const now = Date.now();
    // Phase 8 — stamp client device info so /me/sessions can show
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
    };
    const refreshRecord: RefreshTokenRecord = {
      user_id: user.id,
      organization_id: organization.id,
      issued_at: now,
      expires_at: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
      client_info: clientInfoStamped,
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
      .sadd(indexKey, accessTokenKey(accessToken), refreshTokenKey(refreshToken))
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
  // Preserve session_started_at across rotations so /me/sessions can
  // accurately show "logged in N days ago" even after many refreshes.
  const carriedClientInfo = record.client_info;
  const newAccessRecord: AccessTokenRecord = {
    user_id: record.user_id,
    organization_id: record.organization_id,
    issued_at: now,
    expires_at: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
    client_info: carriedClientInfo,
  };
  const newRefreshRecord: RefreshTokenRecord = {
    user_id: record.user_id,
    organization_id: record.organization_id,
    issued_at: now,
    expires_at: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
    client_info: carriedClientInfo,
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
    .sadd(indexKey, accessTokenKey(newAccessToken), refreshTokenKey(newRefreshToken))
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
function chRepoOrUndefined(): GatewayBudgetClickHouseRepository | undefined {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayBudgetClickHouseRepository(async (projectId) => {
    const client = await getClickHouseClientForProject(projectId);
    if (!client) {
      throw new Error(
        `ClickHouse enabled but no client for project ${projectId}`,
      );
    }
    return client;
  });
}

function requestIncreaseUrl(opts: {
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
}): string {
  const base =
    env.NEXTAUTH_URL ?? env.BASE_HOST ?? "http://localhost:5560";
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
    chRepoOrUndefined(),
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
  const service = CliBootstrapService.create(prisma);
  const result = await service.resolve({
    userId: tokenRecord.user_id,
    organizationId: tokenRecord.organization_id,
  });
  return c.json(result, 200);
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
// `langwatch/src/server/api/enterprise.ts` but speaks REST 402 instead
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
  const allowed = await hasOrganizationPermission(
    { prisma, session: { user: { id: tokenRecord.user_id } } } as any,
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

secured.access(CLI_POLICY).get("/governance/ingest/sources", async (c: Context) => {
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
    : sources.filter((s: { archivedAt: Date | null }) => s.archivedAt === null);
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

secured.access(CLI_POLICY).get("/governance/ingest/sources/:id/events", async (c: Context) => {
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
      { error: "invalid_request", error_description: "source id is required" },
      400,
    );
  }
  const limitRaw = c.req.query("limit");
  const beforeIso = c.req.query("before_iso") ?? undefined;
  const limit = limitRaw ? Math.min(Math.max(1, parseInt(limitRaw, 10)), 200) : 50;

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

secured.access(CLI_POLICY).get("/governance/ingest/sources/:id/health", async (c: Context) => {
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
  const denied = await ensureGovernancePermissionOr403(
    c,
    tokenRecord,
    "activityMonitor:view",
  );
  if (denied) return denied;
  const sourceId = c.req.param("id");
  if (!sourceId) {
    return c.json(
      { error: "invalid_request", error_description: "source id is required" },
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
  const setupService = GovernanceSetupStateService.create(prisma);
  const setup = await setupService.resolve(tokenRecord.organization_id);
  return c.json({ setup });
});

// ---------------------------------------------------------------------------
// Ingestion templates + ingestion keys — device-session adapters.
// ---------------------------------------------------------------------------
// `langwatch <tool>` wrapper-mode (typescript-sdk/.../wrapper-mode.ts) calls
// these from a device-session context (Bearer lw_at_*). The public REST at
// /api/governance/ingestion-templates is mounted under createProjectApp and
// rejects device tokens with 401; these adapter routes resolve
// organizationId+userId from the validated access token and delegate to the
// same services. Wire shape matches what cli-api.ts expects (snake_case
// ingestion_templates), distinct from the project-API-key REST's
// { data: [...] } shape.
// ---------------------------------------------------------------------------

secured.access(CLI_POLICY).get(
  "/governance/ingestion-templates",
  async (c: Context) => {
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
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/cli/governance/ingestion-key
// ---------------------------------------------------------------------------
// Mints (rotating in place) a personal-project ingestion key for the
// device-session caller, replacing the retired binding install/rotate
// adapters. The unified `langwatch <tool>` CLI Path B calls this to obtain a
// write-only `sk-lw-` token + the OTLP endpoint, then points the tool's OTLP
// exporter at it. `source_type` carries the tool slug stamped as
// `langwatch.source` provenance. Body: { source_type }. Returns
// { token, prefix, endpoint } where endpoint = `${baseUrl}/api/otel`.
// ---------------------------------------------------------------------------
const mintIngestionKeySchema = z.object({
  source_type: z.string().min(1),
});

secured.access(CLI_POLICY).post(
  "/governance/ingestion-key",
  async (c: Context) => {
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
    const service = IngestionKeyService.create(prisma);
    try {
      const result = await service.ensureForPersonalProject({
        userId: tokenRecord.user_id,
        organizationId: tokenRecord.organization_id,
        sourceType: parsed.data.source_type,
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
      // No personal project for the caller yet — surface as a precondition
      // so the CLI can prompt the user to finish workspace setup.
      return c.json(
        {
          error: "precondition_failed",
          error_description:
            err instanceof Error ? err.message : "Could not mint ingestion key",
        },
        412,
      );
    }
  },
);

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
      // The browser approval page branches its UX on this — `device_session`
      // shows today's approve-only flow, `project_api_key` shows a project
      // picker + "Generate" CTA. Defaults to device_session for back-compat
      // with records minted before this field existed.
      credential_type: record.credential_type ?? "device_session",
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /api/auth/cli/approve
// ---------------------------------------------------------------------------
// Called by the browser-side /cli/auth page when the user clicks
// "Approve". Mints (or returns existing) personal VK and flips the
// device-code record to `approved`. Session-protected.
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
});

secured.access(CLI_POLICY).post("/approve", async (c: Context) => {
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

  // Verify caller is a member of the org they're issuing a key for.
  const membership = await prisma.organizationUser.findUnique({
    where: {
      userId_organizationId: { userId: session.user.id, organizationId: organization_id },
    },
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
          error_description: "project_id is required when credential_type is project_api_key",
        },
        400,
      );
    }
    // Verify the user actually has access to the project: the project must
    // belong to a team in the chosen org, and the user must be a member of
    // that team (PG schema enforces this via TeamUser; we re-check here so
    // a hostile browser request can't be tricked into leaking another org's
    // key by spoofing project_id).
    const project = await prisma.project.findFirst({
      where: {
        id: project_id,
        archivedAt: null,
        team: {
          organizationId: organization_id,
          members: { some: { userId: session.user.id } },
        },
      },
      select: { id: true, slug: true, name: true, apiKey: true, isPersonal: true },
    });
    if (!project) {
      return c.json(
        {
          error: "forbidden",
          error_description:
            "Project not found in this organization, or you do not have access to it",
        },
        403,
      );
    }

    // Project login must target a real, shared project, never a personal
    // workspace project. A coding agent that picked (or had auto-selected)
    // the personal project silently sent the user's evaluations there
    // (customer report). The browser picker hides personal projects; this
    // is the server-side guarantee.
    if (project.isPersonal) {
      return c.json(
        {
          error: "personal_project_not_allowed",
          error_description:
            "Personal projects can't back a project API key. Pick a shared team project so your evaluations, prompts and traces land on a real project.",
        },
        400,
      );
    }

    // The returned Project.apiKey is the shared write credential and is
    // usable outside the UI's RBAC constraints, so team membership alone
    // is not enough: require a write-capable project permission. A
    // view-only member cannot extract it.
    const canWriteProject = await hasProjectPermission(
      { prisma, session },
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
  // That is a governance-plane capability; for an org without governance
  // enabled it silently created a personal project that then captured the
  // user's evaluations (customer report). Refuse it and point at project
  // login, which writes a real project's API key to `.env`.
  const governanceEnabled = await featureFlagService
    .isEnabled("release_ui_ai_governance_enabled", {
      distinctId: session.user.id,
      organizationId: organization_id,
      defaultValue: false,
    })
    .catch(() => false);
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

  // Mint (or return) the user's default personal VK for this org.
  // Idempotent — if already present, the service throws
  // PersonalVirtualKeyAlreadyExistsError; we map that to 409 so the
  // user knows they already have a default and should run a fresh
  // login on the new device only after revoking the old one.
  const service = PersonalVirtualKeyService.create(prisma);
  let issued;
  try {
    issued = await service.ensureDefault({
      userId: session.user.id,
      organizationId: organization_id,
      displayName: session.user.name,
      displayEmail: session.user.email,
    });
  } catch (err) {
    if (
      err instanceof NoEligibleProvidersError ||
      err instanceof RoutingPolicyHasNoProvidersError
    ) {
      // Fresh signup / dogfood account / org with no accessible
      // providers (or with an explicitly-pinned empty policy): log the
      // user in with a device session anyway. The /me Model Providers
      // tile surfaces the actionable "add a provider" CTA; failing the
      // entire approve flow here blocked solo devs from ever reaching
      // the setup screens. Post-fix to the no-default-policy graceful
      // fallback, this branch fires only when there are truly zero
      // eligible providers via scope cascade.
      logger.info(
        {
          user_code,
          organization_id,
          reason:
            err instanceof NoEligibleProvidersError
              ? "no_eligible_providers"
              : "routing_policy_has_no_providers",
        },
        "[auth-cli] approving device session without personal VK; admin/user must configure provider before gateway use",
      );
      await approveDeviceCode({
        deviceCode: record.device_code,
        userId: session.user.id,
        organizationId: organization_id,
      });
      return c.json({ ok: true, organization_id }, 200);
    }
    if (err instanceof PersonalVirtualKeyAlreadyExistsError) {
      // Issue an additional device-specific key instead so multiple
      // devices don't have to share the "default" key. Label includes
      // a short suffix from the user_code for human discoverability.
      const labelSuffix = user_code.replace("-", "").toLowerCase().slice(0, 6);
      const workspace = await prisma.team.findFirst({
        where: {
          organizationId: organization_id,
          ownerUserId: session.user.id,
          isPersonal: true,
        },
        select: {
          id: true,
          projects: {
            where: { isPersonal: true, archivedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!workspace?.projects[0]) {
        return c.json(
          { error: "server_error", error_description: "Personal workspace missing" },
          500,
        );
      }
      issued = await service.issue({
        userId: session.user.id,
        organizationId: organization_id,
        personalProjectId: workspace.projects[0].id,
        personalTeamId: workspace.id,
        label: `device-${labelSuffix}`,
      });
    } else {
      logger.error(
        { err, user_code },
        `[auth-cli] approve failed for ${user_code}`,
      );
      // Surface the actionable case where the org has no provider
      // credentials configured yet — admin needs to set one up before
      // users can issue personal VKs (storyboard Screen 4 prerequisite).
      // Other errors stay generic to avoid leaking internals.
      const message =
        err instanceof Error && /provider credential is required/i.test(err.message)
          ? "Your admin needs to configure a model provider first. Ask them to add one at Settings → Model Providers."
          : "Failed to issue key";
      return c.json(
        { error: "server_error", error_description: message },
        500,
      );
    }
  }

  await approveDeviceCode({
    deviceCode: record.device_code,
    userId: session.user.id,
    organizationId: organization_id,
    personalVk: {
      id: issued.virtualKey.id,
      label: issued.virtualKey.name,
      secret: issued.secret,
      base_url: issued.baseUrl,
    },
  });

  return c.json(
    {
      ok: true,
      personal_vk_label: issued.virtualKey.name,
      organization_id,
    },
    200,
  );
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
  const ops = redis.multi();
  if (parsed.data.refresh_token) {
    ops.del(refreshTokenKey(parsed.data.refresh_token));
  }
  if (parsed.data.access_token) {
    ops.del(accessTokenKey(parsed.data.access_token));
  }
  await ops.exec();
  return c.json({ ok: true });
});

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
 * Approve a device-code session — flips status to `approved` and stamps
 * the user/org/credential payload that the next /exchange poll returns.
 * The shape of the credential payload depends on the device-code's
 * `credential_type`:
 *
 *   - `device_session` (default): caller supplies `personalVk`
 *   - `project_api_key`: caller supplies `projectApiKey`
 *
 * Exactly one of `personalVk` / `projectApiKey` must be passed; the
 * caller (browser approval handler) is responsible for picking the right
 * one based on `record.credential_type`.
 */
export async function approveDeviceCode({
  deviceCode,
  userId,
  organizationId,
  personalVk,
  projectApiKey,
}: {
  deviceCode: string;
  userId: string;
  organizationId: string;
  personalVk?: {
    id: string;
    label: string;
    secret: string;
    base_url: string;
  };
  projectApiKey?: {
    project_id: string;
    project_slug: string;
    project_name: string;
    api_key: string;
  };
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
    personal_vk: personalVk,
    project_api_key: projectApiKey,
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
