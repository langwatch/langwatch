import { randomBytes } from "node:crypto";

/**
 * The RFC 8628 device grant's state: device codes, their user-code index, the poll window,
 * and the access/refresh token pair a completed grant mints.
 */
import type { CliKeySelection } from "@langwatch/api-key-contract";
import {
  CliDeviceFlowRefusedError,
  CliSessionRecordNotFoundError,
  type CliTokenRecordEntry,
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserTokensIndexKey,
} from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import { nowInstant } from "@langwatch/time";

import type { CliDeviceSettlementChannel } from "../channels/cli-device-settlement.channel.ts";
import type { CliDeviceSessionRepository } from "../repositories/cli-device-session.repository.ts";

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

/**
 * The exclusive redemption claim on an approved device code. Separate from the
 * poll window because it answers a different question: not "is this client
 * polling too fast" but "is somebody already spending this code".
 */
function exchangeClaimKey(deviceCode: string): string {
  return `${DEVICE_CODE_PREFIX}claim:${deviceCode}`;
}

/** The token keys of the children forked from one session family. */
function familyIndexKey(familyId: string): string {
  return `lwcli:family:${familyId}`;
}

/** Everything the device grant stores, over one process's substrate. */
export class CliDeviceSessionService {
  /**
   * Extract the bearer access token from an `Authorization` header, or null.
   */
  static extractBearerCliAccessToken(authHeader: string | null | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const match = BEARER_ACCESS_TOKEN_REGEX.exec(authHeader.trim());

    return match ? match[1]! : null;
  }

  static create(options: {
    store: CliDeviceSessionRepository;
    /** Where a settled code is announced to the approval stream the CLI waits on. */
    settlements: CliDeviceSettlementChannel;
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
      options.settlements,
    );
  }

  private constructor(
    private readonly store: CliDeviceSessionRepository,
    readonly refreshTokenTtlSeconds: number,
    private readonly settlements: CliDeviceSettlementChannel,
  ) {}

  // -- the device code ------------------------------------------------------

  /** Mints a pending device code and its user-code index entry. */
  async startDeviceCode(input: {
    credentialType: CliCredentialType;
    management?: boolean | undefined;
  }): Promise<CliDeviceCodeRecord> {
    const now = nowInstant().epochMilliseconds;
    const record: CliDeviceCodeRecord = {
      device_code: randomBytes(32).toString("base64url"),
      user_code: generateUserCode(),
      status: "pending",
      created_at: now,
      expires_at: now + DEVICE_CODE_TTL_SECONDS * 1000,
      credential_type: input.credentialType,
      ...(input.management ? { management: true } : {}),
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

  /**
   * The record behind the device code the CLI polls with. Never minted, or
   * evicted, refuses with RFC 8628's recommended `expired_token`.
   */
  getDeviceCode(deviceCode: string): Promise<CliDeviceCodeRecord> {
    return this.#storedDeviceCode(deviceCode).catch((error: unknown) => {
      if (!isRecordNotFound(error)) throw error;

      throw new CliDeviceFlowRefusedError({
        refusal: { error: "expired_token", error_description: "Device code expired or unknown" },
        httpStatus: 408,
      });
    });
  }

  /**
   * The record behind a user-typed short code, refusing an unknown one as
   * `not_found` with the caller's own description. Case-folded because the
   * code is read off a screen and typed back in.
   */
  getDeviceCodeByUserCode(input: {
    userCode: string;
    unknownDescription: string;
  }): Promise<CliDeviceCodeRecord> {
    return this.#storedDeviceCodeByUserCode(input.userCode).catch((error: unknown) => {
      if (!isRecordNotFound(error)) throw error;

      throw new CliDeviceFlowRefusedError({
        refusal: { error: "not_found", error_description: input.unknownDescription },
        httpStatus: 404,
      });
    });
  }

  async #storedDeviceCode(deviceCode: string): Promise<CliDeviceCodeRecord> {
    return JSON.parse(await this.store.get(deviceCodeKey(deviceCode))) as CliDeviceCodeRecord;
  }

  async #storedDeviceCodeByUserCode(userCode: string): Promise<CliDeviceCodeRecord> {
    return this.#storedDeviceCode(await this.store.get(userCodeKey(userCode.toUpperCase())));
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
   * Claims the exclusive right to redeem this approved device code. The
   * device-session mint revokes the previous key for the same device label,
   * so two redemptions would hand out two credential sets and kill the first.
   */
  claimExchange(deviceCode: string): Promise<boolean> {
    return this.store.setIfAbsent({
      key: exchangeClaimKey(deviceCode),
      value: "1",
      ttlSeconds: EXCHANGE_CLAIM_SECONDS,
    });
  }

  /**
   * Claims the one rotation a refresh token may buy, so two concurrent presentations of the same
   * token cannot both mint a pair. The loser is refused as a spent token.
   */
  claimRotation(refreshToken: string): Promise<boolean> {
    return this.store.setIfAbsent({
      key: `lwcli:refresh-claim:${refreshToken}`,
      value: "1",
      ttlSeconds: EXCHANGE_CLAIM_SECONDS,
    });
  }

  /** Releases a rotation claim that minted nothing, so the token can be presented again. */
  releaseRotationClaim(refreshToken: string): Promise<void> {
    return this.store.delete(`lwcli:refresh-claim:${refreshToken}`);
  }

  /**
   * Releases a claim that bought nothing, so the next poll can try. Only for
   * paths that consumed NOTHING: releasing a successful redemption's claim
   * early could let a late reader re-claim and mint a second credential.
   */
  releaseExchangeClaim(deviceCode: string): Promise<void> {
    return this.store.delete(exchangeClaimKey(deviceCode));
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
   * project grant, the picked project — the next `/exchange` poll binds the session to.
   */
  async approveDeviceCode(input: {
    deviceCode: string;
    userId: string;
    organizationId: string;
    project?: CliDeviceCodeRecord["project"];
    keySelection?: CliKeySelection | undefined;
  }): Promise<{ approved: boolean }> {
    const record = await this.#storedDeviceCode(input.deviceCode).catch((error: unknown) => {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    });
    if (!record) {
      return { approved: false };
    }

    if (nowInstant().epochMilliseconds > record.expires_at) {
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
      project: input.project,
      key_selection: input.keySelection,
    };
    await this.rewriteDeviceCode(updated);
    await this.settlements.publish({ deviceCode: input.deviceCode, status: "approved" });

    return { approved: true };
  }

  /**
   * Flips the device code behind a user-typed short code to `denied`, leaving
   * the CLI's poll to report it. Idempotent: denying an unknown code is a no-op.
   */
  async denyDeviceCodeByUserCode(userCode: string): Promise<void> {
    const record = await this.#storedDeviceCodeByUserCode(userCode).catch((error: unknown) => {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    });
    if (!record) {
      return;
    }

    await this.rewriteDeviceCode({ ...record, status: "denied" });
    await this.settlements.publish({ deviceCode: record.device_code, status: "denied" });
  }

  /** Hears the next settlement of one device code; resolves once live, with its release. */
  listenForSettlement(input: {
    deviceCode: string;
    onSettled: (status: string) => void;
  }): Promise<() => void> {
    return this.settlements.listen(input);
  }

  /** Rewrites a device code in place, preserving what is left of its lifetime. */
  private async rewriteDeviceCode(record: CliDeviceCodeRecord): Promise<void> {
    const remainingMs = Math.max(1000, record.expires_at - nowInstant().epochMilliseconds);
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
    projectId?: string | undefined;
    clientInfo?: CliClientInfo | undefined;
    cliApiKeyId?: string | undefined;
    projectLocked?: boolean | undefined;
    /** The family a rotation carries; a new one is started when absent. */
    familyId?: string | undefined;
    /** Files the pair as a child of this family, so ending the family ends it. */
    parentFamilyId?: string | undefined;
  }): Promise<CliMintedSession> {
    const accessToken = `lw_at_${randomBytes(32).toString("base64url")}`;
    const refreshToken = `lw_rt_${randomBytes(32).toString("base64url")}`;
    const now = nowInstant().epochMilliseconds;
    const shared = {
      user_id: input.userId,
      organization_id: input.organizationId,
      project_id: input.projectId,
      issued_at: now,
      client_info: input.clientInfo,
      cli_api_key_id: input.cliApiKeyId,
      ...(input.projectLocked ? { project_locked: true } : {}),
      family_id: input.familyId ?? randomBytes(16).toString("base64url"),
      ...(input.parentFamilyId ? { parent_family_id: input.parentFamilyId } : {}),
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
    const memberKeys = [cliAccessTokenKey(accessToken), cliRefreshTokenKey(refreshToken)];
    const ttlMs = this.refreshTokenTtlSeconds * 1000;
    await this.store.indexTokens({
      indexKey: cliUserTokensIndexKey(input.userId),
      memberKeys,
      ttlMs,
    });
    if (input.parentFamilyId) {
      await this.store.indexTokens({
        indexKey: familyIndexKey(input.parentFamilyId),
        memberKeys,
        ttlMs,
      });
    }

    return {
      accessToken,
      refreshToken,
      accessTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlSeconds: this.refreshTokenTtlSeconds,
    };
  }

  /**
   * The refresh record behind one refresh token. Unknown, revoked or
   * unreadable refuses as `invalid_grant`, on which the CLI wipes local state.
   */
  async getRefreshToken(refreshToken: string): Promise<CliRefreshTokenRecord> {
    const raw = await this.store.get(cliRefreshTokenKey(refreshToken)).catch((error: unknown) => {
      if (isRecordNotFound(error)) return undefined;
      throw error;
    });
    const record =
      raw === undefined ? null : CliDeviceSessionService.decodeSession<CliRefreshTokenRecord>(raw);
    if (!record) {
      throw new CliDeviceFlowRefusedError({
        refusal: {
          error: "invalid_grant",
          error_description: "Refresh token is invalid or revoked",
        },
        httpStatus: 401,
      });
    }

    return record;
  }

  /**
   * A stored session record, or null when it no longer decodes. That should be
   * a named `cli_session_unreadable` refusal saying "sign in again";
   * `auth/contract` cannot declare one yet, so null keeps the caller's 401.
   */
  private static decodeSession<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * The family a session heads. A session minted before families existed is given one now,
   * written back onto its refresh record, so the child about to be forked is filed under it.
   */
  async familyOf(input: { refreshToken: string; record: CliRefreshTokenRecord }): Promise<string> {
    if (input.record.family_id) return input.record.family_id;

    const familyId = randomBytes(16).toString("base64url");
    const remainingMs = input.record.expires_at - nowInstant().epochMilliseconds;
    await this.store.set({
      key: cliRefreshTokenKey(input.refreshToken),
      value: JSON.stringify({ ...input.record, family_id: familyId }),
      ttlSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    });

    return familyId;
  }

  /**
   * Ends every child forked from these sessions' families, answering how many records were held.
   */
  private async endChildren(
    records: readonly Pick<CliRefreshTokenRecord, "family_id">[],
  ): Promise<number> {
    let ended = 0;
    for (const familyId of new Set(records.flatMap(({ family_id }) => family_id ?? []))) {
      const indexKey = familyIndexKey(familyId);
      const memberKeys = await this.store.findIndexedTokens(indexKey);
      ended += await this.store.deleteIndexedTokens({ indexKey, memberKeys });
    }

    return ended;
  }

  /** Drops one refresh token, which is what makes a rejected rotation final. */
  dropRefreshToken(refreshToken: string): Promise<void> {
    return this.store.delete(cliRefreshTokenKey(refreshToken));
  }

  /**
   * The record behind a bearer access token. No bearer, an unknown or
   * unreadable record, or an expired one all throw `CliSessionRecordNotFoundError`.
   */
  async getAccessToken(authHeader: string | null | undefined): Promise<CliAccessTokenRecord> {
    const token = CliDeviceSessionService.extractBearerCliAccessToken(authHeader);
    if (!token) {
      throw new CliSessionRecordNotFoundError();
    }

    const record = CliDeviceSessionService.decodeSession<CliAccessTokenRecord>(
      await this.store.get(cliAccessTokenKey(token)),
    );
    if (!record) {
      throw new CliSessionRecordNotFoundError();
    }

    if (nowInstant().epochMilliseconds > record.expires_at) {
      await this.store.delete(cliAccessTokenKey(token));

      throw new CliSessionRecordNotFoundError();
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
    const token = CliDeviceSessionService.extractBearerCliAccessToken(input.authHeader);
    if (!token) {
      return;
    }

    await this.store.delete(cliAccessTokenKey(token));
    await this.store.removeFromIndex({
      indexKey: cliUserTokensIndexKey(input.userId),
      memberKey: cliAccessTokenKey(token),
    });
  }

  /** Every CLI token a person still holds, read through their own index. */
  async findTokenRecordsForUser({ userId }: { userId: string }): Promise<CliTokenRecordEntry[]> {
    const entries: CliTokenRecordEntry[] = [];
    for (const tokenKey of await this.store.findIndexedTokens(cliUserTokensIndexKey(userId))) {
      const raw = await this.store.get(tokenKey).catch((error: unknown) => {
        if (isRecordNotFound(error)) return undefined;
        throw error;
      });
      const record =
        raw === undefined
          ? null
          : CliDeviceSessionService.decodeSession<CliAccessTokenRecord | CliRefreshTokenRecord>(
              raw,
            );
      if (!record || record.user_id !== userId) continue;

      entries.push(CliDeviceSessionService.toTokenRecordEntry({ tokenKey, record }));
    }
    return entries;
  }

  /** Revokes a person's CLI tokens: the named ones inside their index, or all of it. */
  async revokeTokens({
    userId,
    tokenKeys,
  }: {
    userId: string;
    tokenKeys?: readonly string[] | undefined;
  }): Promise<{ revokedCount: number }> {
    const indexKey = cliUserTokensIndexKey(userId);
    const indexed = await this.store.findIndexedTokens(indexKey);
    const memberKeys =
      tokenKeys === undefined ? indexed : indexed.filter((key) => tokenKeys.includes(key));
    const parents: Pick<CliRefreshTokenRecord, "family_id">[] = [];
    for (const memberKey of memberKeys) {
      const raw = await this.store.get(memberKey).catch((error: unknown) => {
        if (isRecordNotFound(error)) return undefined;
        throw error;
      });
      const record =
        raw === undefined
          ? null
          : CliDeviceSessionService.decodeSession<CliRefreshTokenRecord>(raw);
      if (record) parents.push(record);
    }
    // A revoked session's forks go with it.
    const children = await this.endChildren(parents);
    return {
      revokedCount: children + (await this.store.deleteIndexedTokens({ indexKey, memberKeys })),
    };
  }

  private static toTokenRecordEntry({
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

  /**
   * Reads then drops whichever halves of a session a logout named, returning the records so
   * the caller can revoke the CLI key they carry.
   */
  async endSession(input: {
    refreshToken?: string | undefined;
    accessToken?: string | undefined;
  }): Promise<(CliRefreshTokenRecord | CliAccessTokenRecord)[]> {
    const records: (CliRefreshTokenRecord | CliAccessTokenRecord)[] = [];
    for (const [token, keyFor] of [
      [input.refreshToken, cliRefreshTokenKey],
      [input.accessToken, cliAccessTokenKey],
    ] as const) {
      if (!token) {
        continue;
      }

      const raw = await this.store.get(keyFor(token)).catch((error: unknown) => {
        if (isRecordNotFound(error)) return undefined;
        throw error;
      });
      if (raw !== undefined) {
        try {
          records.push(JSON.parse(raw) as CliRefreshTokenRecord);
        } catch (error) {
          // A record we cannot read is one we cannot revoke a key from; the
          // delete below still happens, which is what logout promises.
          void error;
        }
      }

      await this.store.delete(keyFor(token));
    }
    // Ending a session ends the children forked from it.
    await this.endChildren(records);

    return records;
  }
}

function isRecordNotFound(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "cli_session_record_not_found";
}
