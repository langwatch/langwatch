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
import { Hono } from "hono";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { env } from "~/env.mjs";
import { connection as redisConnection } from "~/server/redis";
import { prisma } from "~/server/db";
import { getServerAuthSession } from "~/server/auth";
import { PersonalVirtualKeyService } from "~/server/governance/personalVirtualKey.service";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:auth-cli");

export const app = new Hono().basePath("/api/auth/cli");

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
const POLL_RATE_PREFIX = "lwcli:poll:"; // Redis key prefix for poll-rate-limit window

type DeviceCodeStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

interface DeviceCodeRecord {
  device_code: string;
  user_code: string;
  status: DeviceCodeStatus;
  created_at: number; // unix ms
  expires_at: number; // unix ms
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
}

interface RefreshTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
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
});

app.post("/device-code", async (c: Context) => {
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
const exchangeRequestSchema = z.object({
  device_code: z.string().min(1),
});

app.post("/exchange", async (c: Context) => {
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
    await redis.del(deviceCodeKey(device_code), userCodeKey(record.user_code));
    return c.json(
      { error: "expired_token", error_description: "Device code expired" },
      408,
    );
  }

  if (record.status === "denied") {
    await redis.del(deviceCodeKey(device_code), userCodeKey(record.user_code));
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
    if (!record.user_id || !record.organization_id || !record.personal_vk) {
      // Should not happen — approval handler always populates these. Treat
      // as a transient pending state so the CLI keeps polling rather than
      // crashing. Worst case the user re-runs `langwatch login`.
      logger.warn(
        `[auth-cli] approved device_code ${device_code} missing user/org/vk payload — returning pending`,
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

    // Mint access + refresh tokens, persist refresh in Redis with TTL.
    const accessToken = generateAccessToken();
    const refreshToken = generateRefreshToken();
    const refreshRecord: RefreshTokenRecord = {
      user_id: user.id,
      organization_id: organization.id,
      issued_at: Date.now(),
      expires_at: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    };
    await redis.set(
      refreshTokenKey(refreshToken),
      JSON.stringify(refreshRecord),
      "EX",
      REFRESH_TOKEN_TTL_SECONDS,
    );

    // Single-use device_code: delete after successful exchange.
    await redis.del(deviceCodeKey(device_code), userCodeKey(record.user_code));

    return c.json(
      {
        access_token: accessToken,
        token_type: "Bearer",
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

app.post("/refresh", async (c: Context) => {
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

  // Rotate: mint new pair, invalidate old. (Sliding-window rotation —
  // standard OAuth pattern, helps detect stolen tokens.)
  const newAccessToken = generateAccessToken();
  const newRefreshToken = generateRefreshToken();
  const newRecord: RefreshTokenRecord = {
    user_id: record.user_id,
    organization_id: record.organization_id,
    issued_at: Date.now(),
    expires_at: Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
  };

  await redis
    .multi()
    .set(
      refreshTokenKey(newRefreshToken),
      JSON.stringify(newRecord),
      "EX",
      REFRESH_TOKEN_TTL_SECONDS,
    )
    .del(refreshTokenKey(refresh_token))
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
// GET /api/auth/cli/lookup?user_code=XXXX-YYYY
// ---------------------------------------------------------------------------
// Used by the browser-side approval page to surface the device-code
// metadata (originating CLI hostname, request time) before the user
// approves. Session-protected so unauthenticated visitors can't probe
// outstanding device codes.
// ---------------------------------------------------------------------------
app.get("/lookup", async (c: Context) => {
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
});

app.post("/approve", async (c: Context) => {
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
  const { user_code, organization_id } = parsed.data;

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
    if (err instanceof Error && err.name === "PersonalVirtualKeyAlreadyExistsError") {
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
      return c.json(
        { error: "server_error", error_description: "Failed to issue key" },
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

app.post("/deny", async (c: Context) => {
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
// POST /api/auth/cli/logout — revoke a refresh_token explicitly.
// (CLI uses this in `langwatch logout` so the local config wipe is
// matched by a server-side revocation.)
// ---------------------------------------------------------------------------
app.post("/logout", async (c: Context) => {
  const redis = getRedis();
  const body = await c.req.json().catch(() => ({}));
  const parsed = refreshRequestSchema.safeParse(body);
  if (!parsed.success) {
    // 200 either way — logout is idempotent and we don't want clients
    // to fail if they pass garbage; just nothing to revoke.
    return c.json({ ok: true });
  }
  await redis.del(refreshTokenKey(parsed.data.refresh_token));
  return c.json({ ok: true });
});

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
 * the user/org/personal-VK payload that the next /exchange poll returns.
 *
 * Called by the browser approval handler after the user has completed
 * SSO and confirmed the CLI authorization request.
 */
export async function approveDeviceCode({
  deviceCode,
  userId,
  organizationId,
  personalVk,
}: {
  deviceCode: string;
  userId: string;
  organizationId: string;
  personalVk: {
    id: string;
    label: string;
    secret: string;
    base_url: string;
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
