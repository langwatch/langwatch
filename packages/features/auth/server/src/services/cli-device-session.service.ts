/**
 * The RFC 8628 device grant's state: device codes, their user-code index, the poll window,
 * and the access/refresh token pair a completed grant mints.
 */
import type { CliKeySelection } from "@langwatch/api-key-contract";
import {
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserTokensIndexKey,
} from "@langwatch/auth-contract";
import { randomBytes } from "node:crypto";

import type { CliDeviceSessionStorePort } from "../ports/cli-device-session-store.port";

/** Redis key prefix for device-code records. */
const DEVICE_CODE_PREFIX = "lwcli:device:";
/** Redis key prefix for the per-device-code poll window. */
const POLL_RATE_PREFIX = "lwcli:poll:";

/** Lifetime of an unredeemed device_code, in seconds. */
export const DEVICE_CODE_TTL_SECONDS = 600; // 10 min
/** Minimum poll interval the CLI should respect. */
export const MIN_POLL_INTERVAL_SECONDS = 5;
/** Access token lifetime. Short; refresh is the rotation path. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1h
/** Min seconds between successive `/exchange` polls per device_code. */
export const POLL_RATE_LIMIT_SECONDS = 4;
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
   * For `credential_type: "project_api_key"` after approval — the picked
   * project's existing API key plus identifying fields, shipped to the CLI on
   * the next `/exchange` poll. Mutable across approvals (the user can re-pick).
   */
  project_api_key?: {
    project_id: string;
    project_slug: string;
    project_name: string;
    api_key: string;
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
  issued_at: number;
  expires_at: number;
  client_info?: CliClientInfo;
  /**
   * The user-scoped CLI key `/exchange` minted for this session, carried
   * across `/refresh` rotations so `/logout` can revoke the key alongside the
   * tokens. Absent for sessions that minted no key.
   */
  cli_api_key_id?: string;
}

export interface CliAccessTokenRecord {
  user_id: string;
  organization_id: string;
  issued_at: number;
  expires_at: number;
  /** Mirror of the refresh record's field; the devices inventory reads it. */
  client_info?: CliClientInfo;
  /** Mirror of the refresh record's field; see there. */
  cli_api_key_id?: string;
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
const BEARER_ACCESS_TOKEN_REGEX = /^Bearer\s+(lw_at_[A-Za-z0-9_-]+)$/;

/**
 * Generate an RFC 8628 user_code: 8 characters, dashed in the middle for readability, on a
 * base32 alphabet that excludes the ambiguous ones.
 */
function generateUserCode(): string {
  // Crockford-ish base32 minus 0/O/I/L/U for unambiguous human entry.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);

  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

function deviceCodeKey(deviceCode: string): string {
  return `${DEVICE_CODE_PREFIX}${deviceCode}`;
}

/**
 * The user-code index, stored separately so the browser can resolve a pasted
 * short code back to its device code.
 */
function userCodeKey(userCode: string): string {
  return `${DEVICE_CODE_PREFIX}usercode:${userCode}`;
}

function pollRateKey(deviceCode: string): string {
  return `${POLL_RATE_PREFIX}${deviceCode}`;
}

/** Everything the device grant stores, over one process's substrate. */
export class CliDeviceSessionService {
  /**
   * Extract the bearer access token from an `Authorization` header, or null.
   */
  static bearerCliAccessToken(authHeader: string | null | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const match = BEARER_ACCESS_TOKEN_REGEX.exec(authHeader.trim());

    return match ? match[1]! : null;
  }

  static create(options: {
    store: CliDeviceSessionStorePort;
    /**
     * Refresh-token lifetime for this deployment, in seconds. Shorten it when
     * a stolen `~/.langwatch/config.json` needs to go stale sooner than the
     * default quarter.
     */
    refreshTokenTtlSeconds?: number | undefined;
  }): CliDeviceSessionService {
    return new CliDeviceSessionService(
      options.store,
      options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
    );
  }

  private constructor(
    private readonly store: CliDeviceSessionStorePort,
    readonly refreshTokenTtlSeconds: number,
  ) {}

  // -- the device code ------------------------------------------------------

  /** Mints a pending device code and its user-code index entry. */
  async startDeviceCode(input: {
    credentialType: CliCredentialType;
  }): Promise<CliDeviceCodeRecord> {
    const now = Date.now();
    const record: CliDeviceCodeRecord = {
      device_code: randomBytes(32).toString("base64url"),
      user_code: generateUserCode(),
      status: "pending",
      created_at: now,
      expires_at: now + DEVICE_CODE_TTL_SECONDS * 1000,
      credential_type: input.credentialType,
    };
    await this.store.set({
      key: deviceCodeKey(record.device_code),
      value: JSON.stringify(record),
      ttlSeconds: DEVICE_CODE_TTL_SECONDS,
    });
    await this.store.set({
      key: userCodeKey(record.user_code),
      value: record.device_code,
      ttlSeconds: DEVICE_CODE_TTL_SECONDS,
    });

    return record;
  }

  /** The device-code record behind one device code, or nothing. */
  async tryFindDeviceCode(deviceCode: string): Promise<CliDeviceCodeRecord | null> {
    const raw = await this.store.tryGet(deviceCodeKey(deviceCode));
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as CliDeviceCodeRecord;
  }

  /**
   * The device-code record behind a user-typed short code, or nothing.
   *
   * Case-folded because the code is read off a screen and typed back in.
   */
  async tryFindDeviceCodeByUserCode(userCode: string): Promise<CliDeviceCodeRecord | null> {
    const deviceCode = await this.store.tryGet(userCodeKey(userCode.toUpperCase()));
    if (!deviceCode) {
      return null;
    }

    return await this.tryFindDeviceCode(deviceCode);
  }

  /**
   * Claims this device code's poll window, answering whether the caller may proceed.
   */
  claimPollWindow(deviceCode: string): Promise<boolean> {
    return this.store.setIfAbsent({
      key: pollRateKey(deviceCode),
      value: "1",
      ttlSeconds: POLL_RATE_LIMIT_SECONDS,
    });
  }

  /**
   * Consumes a device code and its index entry.
   */
  async consumeDeviceCode(input: {
    record: Pick<CliDeviceCodeRecord, "device_code" | "user_code">;
    alsoPollWindow?: boolean;
  }): Promise<void> {
    await this.store.delete(deviceCodeKey(input.record.device_code));
    await this.store.delete(userCodeKey(input.record.user_code));
    if (input.alsoPollWindow) {
      await this.store.delete(pollRateKey(input.record.device_code));
    }
  }

  /**
   * Flips a pending device code to `approved` and stamps the identity — and, for a
   * project-key grant, the picked project's key — the next `/exchange` poll returns.
   */
  async approveDeviceCode(input: {
    deviceCode: string;
    userId: string;
    organizationId: string;
    projectApiKey?: CliDeviceCodeRecord["project_api_key"];
    keySelection?: CliKeySelection | undefined;
  }): Promise<{ approved: boolean }> {
    const record = await this.tryFindDeviceCode(input.deviceCode);
    if (!record) {
      return { approved: false };
    }

    if (Date.now() > record.expires_at) {
      return { approved: false };
    }

    if (record.status !== "pending") {
      return { approved: false };
    }

    const updated: CliDeviceCodeRecord = {
      ...record,
      status: "approved",
      user_id: input.userId,
      organization_id: input.organizationId,
      project_api_key: input.projectApiKey,
      key_selection: input.keySelection,
    };
    await this.rewriteDeviceCode(updated);

    return { approved: true };
  }

  /** Flips a device code to `denied`, leaving the CLI's poll to report it. */
  async denyDeviceCode(deviceCode: string): Promise<void> {
    const record = await this.tryFindDeviceCode(deviceCode);
    if (!record) {
      return;
    }

    await this.rewriteDeviceCode({ ...record, status: "denied" });
  }

  /** Rewrites a device code in place, preserving what is left of its lifetime. */
  private async rewriteDeviceCode(record: CliDeviceCodeRecord): Promise<void> {
    const remainingMs = Math.max(1000, record.expires_at - Date.now());
    await this.store.set({
      key: deviceCodeKey(record.device_code),
      value: JSON.stringify(record),
      ttlSeconds: Math.ceil(remainingMs / 1000),
    });
  }

  // -- the session tokens ---------------------------------------------------

  /**
   * Mints an access + refresh pair and files both in the user's token index.
   */
  async mintSession(input: {
    userId: string;
    organizationId: string;
    clientInfo?: CliClientInfo | undefined;
    cliApiKeyId?: string | undefined;
  }): Promise<CliMintedSession> {
    const accessToken = `lw_at_${randomBytes(32).toString("base64url")}`;
    const refreshToken = `lw_rt_${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    const shared = {
      user_id: input.userId,
      organization_id: input.organizationId,
      issued_at: now,
      client_info: input.clientInfo,
      cli_api_key_id: input.cliApiKeyId,
    };
    await this.store.set({
      key: cliAccessTokenKey(accessToken),
      value: JSON.stringify({
        ...shared,
        expires_at: now + ACCESS_TOKEN_TTL_SECONDS * 1000,
      } satisfies CliAccessTokenRecord),
      ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    });
    await this.store.set({
      key: cliRefreshTokenKey(refreshToken),
      value: JSON.stringify({
        ...shared,
        expires_at: now + this.refreshTokenTtlSeconds * 1000,
      } satisfies CliRefreshTokenRecord),
      ttlSeconds: this.refreshTokenTtlSeconds,
    });
    await this.store.indexTokens({
      indexKey: cliUserTokensIndexKey(input.userId),
      memberKeys: [cliAccessTokenKey(accessToken), cliRefreshTokenKey(refreshToken)],
      ttlMs: this.refreshTokenTtlSeconds * 1000,
    });

    return {
      accessToken,
      refreshToken,
      accessTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlSeconds: this.refreshTokenTtlSeconds,
    };
  }

  /** The refresh record behind one refresh token, or nothing. */
  async tryFindRefreshToken(refreshToken: string): Promise<CliRefreshTokenRecord | null> {
    const raw = await this.store.tryGet(cliRefreshTokenKey(refreshToken));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as CliRefreshTokenRecord;
    } catch {
      return null;
    }
  }

  /** Drops one refresh token, which is what makes a rejected rotation final. */
  dropRefreshToken(refreshToken: string): Promise<void> {
    return this.store.delete(cliRefreshTokenKey(refreshToken));
  }

  /**
   * Resolves a bearer access token to its record, or nothing.
   */
  async tryResolveAccessToken(
    authHeader: string | null | undefined,
  ): Promise<CliAccessTokenRecord | null> {
    const token = CliDeviceSessionService.bearerCliAccessToken(authHeader);
    if (!token) {
      return null;
    }

    const raw = await this.store.tryGet(cliAccessTokenKey(token));
    if (!raw) {
      return null;
    }

    let record: CliAccessTokenRecord;
    try {
      record = JSON.parse(raw) as CliAccessTokenRecord;
    } catch {
      return null;
    }

    if (Date.now() > record.expires_at) {
      await this.store.delete(cliAccessTokenKey(token));

      return null;
    }

    return record;
  }

  /**
   * Severs one presented access token: drops the record and its entry in the owner's index.
   */
  async revokeAccessToken(input: {
    authHeader: string | null | undefined;
    userId: string;
  }): Promise<void> {
    const token = CliDeviceSessionService.bearerCliAccessToken(input.authHeader);
    if (!token) {
      return;
    }

    await this.store.delete(cliAccessTokenKey(token));
    await this.store.removeFromIndex({
      indexKey: cliUserTokensIndexKey(input.userId),
      memberKey: cliAccessTokenKey(token),
    });
  }

  /**
   * Reads then drops whichever halves of a session a logout named, returning the records so
   * the caller can revoke the CLI key they carry.
   */
  async endSession(input: {
    refreshToken?: string | undefined;
    accessToken?: string | undefined;
  }): Promise<Array<CliRefreshTokenRecord | CliAccessTokenRecord>> {
    const records: Array<CliRefreshTokenRecord | CliAccessTokenRecord> = [];
    for (const [token, keyFor] of [
      [input.refreshToken, cliRefreshTokenKey],
      [input.accessToken, cliAccessTokenKey],
    ] as const) {
      if (!token) {
        continue;
      }

      const raw = await this.store.tryGet(keyFor(token));
      if (raw) {
        try {
          records.push(JSON.parse(raw) as CliRefreshTokenRecord);
        } catch {
          // A record we cannot read is one we cannot revoke a key from; the
          // delete below still happens, which is what logout promises.
        }
      }

      await this.store.delete(keyFor(token));
    }

    return records;
  }
}
