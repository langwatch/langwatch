/**
 * The device grant's records, store keys and codes: the shapes the session stores
 * and the pure reads of them.
 * @see modules/auth/specs/cli-device-flow.feature
 */

import { randomBytes } from "node:crypto";

import type { CliKeySelection } from "@langwatch/api-key-contract";
import type { CliTokenRecordEntry } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";

/** Redis key prefix for device-code records. */
export const DEVICE_CODE_PREFIX = "lwcli:device:";
/** Redis key prefix for the per-device-code poll window. */
export const POLL_RATE_PREFIX = "lwcli:poll:";

/** Lifetime of an unredeemed device_code, in seconds. */
export const DEVICE_CODE_TTL_SECONDS = 600; // 10 min
/** Minimum poll interval the CLI should respect. */
export const MIN_POLL_INTERVAL_SECONDS = 5;
/** Access token lifetime. Short; refresh is the rotation path. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
/** Min seconds between successive `/exchange` polls per device_code. */
export const POLL_RATE_LIMIT_SECONDS = 4;
/**
 * How long one `/exchange` holds the exclusive redemption claim — longer than
 * the poll window, which only paces polls rather than fencing a slower
 * redemption, but short enough to free the code early if release is skipped.
 */
export const EXCHANGE_CLAIM_SECONDS = 30;
/**
 * Default refresh-token lifetime.
 */
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90; // 90d

export type CliDeviceCodeStatus = "pending" | "approved" | "denied" | "expired";

/**
 * What the CLI is asking the browser to mint on approval.
 */
export type CliCredentialType = "device_session" | "project_api_key";

/**
 * Device metadata captured at `/exchange` so a person can recognise "Bob's MacBook Pro" in
 * the devices inventory and revoke it per device.
 */
export type CliClientInfo = {
  /** Human label, defaults to platform + hostname. e.g. "Macbook Pro". */
  device_label?: string;
  /** `os.hostname()` output. */
  hostname?: string;
  /** `os.userInfo().username`, so two developers on one Mac stay distinct. */
  uname?: string;
  /** "darwin" / "linux" / "win32" — `process.platform`. */
  platform?: string;
  /** First-issued timestamp; preserved across rotations of this session. */
  session_started_at?: number;
};

export interface CliDeviceCodeRecord {
  device_code: string;
  user_code: string;
  status: CliDeviceCodeStatus;
  created_at: number; // unix ms
  expires_at: number; // unix ms
  /** What the CLI is asking the browser to mint. Defaults to `device_session`. */
  credential_type: CliCredentialType;
  /**
   * Whether the CLI asked for management access (`langwatch login --management`).
   * Absent on records minted before the field, which read as not asked.
   */
  management?: boolean;
  /** Set after browser-side approval. */
  user_id?: string;
  organization_id?: string;
  /**
   * Personal virtual key shipped in the `/exchange` response. Approval no
   * longer writes it: the field stays readable so a device approved by another
   * instance mid-rollout still resolves.
   */
  personal_vk?: {
    id: string;
    label: string;
    secret: string;
    base_url: string;
  };
  /**
   * For `credential_type: "project_api_key"` after approval: the picked
   * project the exchange binds the session to. Never a key.
   */
  project?: {
    project_id: string;
    project_slug: string;
    project_name: string;
  };
  /**
   * For `credential_type: "device_session"` after approval — the scope + permission
   * selection the authorize screen approved (or the server-side default when the client sent
   * none). Consumed by `/exchange`, which mints the user-scoped CLI key from it.
   */
  key_selection?: CliKeySelection;
}

export interface CliRefreshTokenRecord {
  user_id: string;
  organization_id: string;
  /** The one project the session is capped at; carried across rotations. */
  project_id?: string;
  issued_at: number;
  expires_at: number;
  client_info?: CliClientInfo;
  /**
   * The user-scoped CLI key `/exchange` minted for this session, carried
   * across `/refresh` rotations so `/logout` can revoke the key alongside the
   * tokens. Absent for sessions that minted no key.
   */
  cli_api_key_id?: string;
  /** Set when the person consented to one project only (hosted MCP): no rotation re-scopes it. */
  project_locked?: boolean;
  /** The family this session heads, carried across rotations; its forks are filed under it. */
  family_id?: string;
  /** On a forked child: the family it was forked from, whose end is its end. */
  parent_family_id?: string;
}

export interface CliAccessTokenRecord {
  user_id: string;
  organization_id: string;
  /** Mirror of the refresh record's field; see there. */
  project_id?: string;
  issued_at: number;
  expires_at: number;
  /** Mirror of the refresh record's field; the devices inventory reads it. */
  client_info?: CliClientInfo;
  /** Mirror of the refresh record's field; see there. */
  cli_api_key_id?: string;
  /** Mirror of the refresh record's field; see there. */
  project_locked?: boolean;
  /** Mirror of the refresh record's field; see there. */
  family_id?: string;
  /** Mirror of the refresh record's field; see there. */
  parent_family_id?: string;
}

/** The pair a completed grant — or a rotation — hands the CLI. */
export type CliMintedSession = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}>;

/**
 * The one grammar for a CLI bearer access token.
 */
export const BEARER_ACCESS_TOKEN_REGEX = /^Bearer\s+(lw_at_[A-Za-z0-9_-]+)$/;

/**
 * Generate an RFC 8628 user_code: 8 characters, dashed in the middle for readability, on a
 * base32 alphabet that excludes the ambiguous ones.
 */
export function generateUserCode(): string {
  // Crockford-ish base32 minus 0/O/I/L/U for unambiguous human entry.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);

  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export function deviceCodeKey(deviceCode: string): string {
  return `${DEVICE_CODE_PREFIX}${deviceCode}`;
}

/**
 * The user-code index, stored separately so the browser can resolve a pasted
 * short code back to its device code.
 */
export function userCodeKey(userCode: string): string {
  return `${DEVICE_CODE_PREFIX}usercode:${userCode}`;
}

export function pollRateKey(deviceCode: string): string {
  return `${POLL_RATE_PREFIX}${deviceCode}`;
}

/**
 * The exclusive redemption claim on an approved device code. Separate from the
 * poll window because it answers a different question: not "is this client
 * polling too fast" but "is somebody already spending this code".
 */
export function exchangeClaimKey(deviceCode: string): string {
  return `${DEVICE_CODE_PREFIX}claim:${deviceCode}`;
}

/** The token keys of the children forked from one session family. */
export function familyIndexKey(familyId: string): string {
  return `lwcli:family:${familyId}`;
}

/** The bearer access token in an `Authorization` header, or null. */
export function extractBearerCliAccessToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = BEARER_ACCESS_TOKEN_REGEX.exec(authHeader.trim());

  return match ? match[1]! : null;
}

/**
 * A stored session record, or null when it no longer decodes. That should be
 * a named `cli_session_unreadable` refusal saying "sign in again";
 * `auth/contract` cannot declare one yet, so null keeps the caller's 401.
 */
export function decodeCliSession<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function toTokenRecordEntry({
  tokenKey,
  record,
}: {
  tokenKey: string;
  record: CliAccessTokenRecord | CliRefreshTokenRecord;
}): CliTokenRecordEntry {
  const info = record.client_info;
  return {
    tokenKey,
    organizationId: record.organization_id,
    ...(record.cli_api_key_id ? { cliApiKeyId: record.cli_api_key_id } : {}),
    issuedAtMs: record.issued_at,
    expiresAtMs: record.expires_at,
    ...(info
      ? {
          clientInfo: {
            deviceLabel: info.device_label,
            hostname: info.hostname,
            uname: info.uname,
            platform: info.platform,
            sessionStartedAtMs: info.session_started_at,
          },
        }
      : {}),
  };
}

export function isRecordNotFound(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "cli_session_record_not_found";
}
