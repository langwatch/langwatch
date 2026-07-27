/**
 * Redis-backed access tokens minted by the RFC 8628 device-authorization flow
 * in `src/server/routes/auth-cli.ts`.
 *
 * This lives outside that route file because the tokens are no longer a CLI
 * private matter: the mobile ops API (`src/server/routes/ops-mobile.ts`)
 * authenticates the same bearer credential, and two implementations of "is this
 * token still good" is exactly the kind of drift that ends with one surface
 * honouring a revocation the other does not.
 *
 * The mint and rotate paths still live in the route file — only the storage
 * shape and the validation are shared, because those are what a consumer needs.
 */
import type { Redis as IORedis, Cluster } from "ioredis";

/** Redis key prefix for access-token records. */
export const CLI_ACCESS_TOKEN_PREFIX = "lwcli:access:";

/**
 * Device metadata captured at /exchange time so users can see "Bob's MacBook
 * Pro" entries in the /me/devices inventory and revoke them per-device. All
 * fields optional to stay backwards-compatible with older clients that don't
 * send client_info; rendered as "Unknown device" in the UI when missing.
 *
 * Spec: specs/ai-governance/sessions/sessions-inventory.feature
 */
export interface CliClientInfo {
  /** Human label, defaults to platform + hostname. e.g. "Macbook Pro". */
  device_label?: string;
  /** os.hostname() output. */
  hostname?: string;
  /** os.userInfo().username so we can disambiguate two devs on same Mac. */
  uname?: string;
  /** "darwin" / "linux" / "win32" / "ios" — the client's platform. */
  platform?: string;
  /** First-issued timestamp; preserved across rotations of this session. */
  session_started_at?: number;
}

export interface CliAccessTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  /** Present when the client sent client_info on /exchange. */
  client_info?: CliClientInfo;
}

export function cliAccessTokenKey(accessToken: string): string {
  return `${CLI_ACCESS_TOKEN_PREFIX}${accessToken}`;
}

/**
 * Resolve a Bearer access_token to its (user_id, organization_id) record.
 * Returns null on missing / expired / malformed.
 *
 * Auth contract: `Authorization: Bearer lw_at_<base64url>`. Anything else,
 * including session cookies, is rejected — these endpoints are token-only, so a
 * browser that happens to be logged in cannot reach them by accident.
 *
 * An expired record is deleted on the way out. Redis TTLs already evict it, but
 * a clock skew between the writer and the expiry means the record can outlive
 * its own `expires_at`; deleting here makes the two agree.
 */
export async function validateCliAccessToken({
  authHeader,
  redis,
}: {
  authHeader: string | null | undefined;
  redis: IORedis | Cluster;
}): Promise<CliAccessTokenRecord | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(lw_at_[A-Za-z0-9_\-]+)$/.exec(authHeader.trim());
  if (!match) return null;
  const token = match[1]!;
  const raw = await redis.get(cliAccessTokenKey(token));
  if (!raw) return null;
  let record: CliAccessTokenRecord;
  try {
    record = JSON.parse(raw) as CliAccessTokenRecord;
  } catch {
    return null;
  }
  if (Date.now() > record.expires_at) {
    await redis.del(cliAccessTokenKey(token));
    return null;
  }
  return record;
}
