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
import { nowInstant } from "@langwatch/time";

import type { CliDeviceSettlementChannel } from "../channels/cli-device-settlement.channel.ts";
import type { CliDeviceSessionRepository } from "../repositories/cli-device-session.repository.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  EXCHANGE_CLAIM_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  POLL_RATE_LIMIT_SECONDS,
  decodeCliSession,
  deviceCodeKey,
  exchangeClaimKey,
  extractBearerCliAccessToken,
  familyIndexKey,
  generateUserCode,
  isRecordNotFound,
  pollRateKey,
  userCodeKey,
  type CliAccessTokenRecord,
  type CliClientInfo,
  type CliCredentialType,
  type CliDeviceCodeRecord,
  type CliMintedSession,
  type CliRefreshTokenRecord,
} from "../rules/cli-device-session.rules.ts";
import { CliDeviceTokenRecordsService } from "./cli-device-token-records.service.ts";

export {
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  type CliClientInfo,
  type CliDeviceCodeRecord,
  type CliMintedSession,
  type CliRefreshTokenRecord,
};

/** Everything the device grant stores, over one process's substrate. */
export class CliDeviceSessionService {
  /** The bearer access token in an `Authorization` header, or null. */
  static extractBearerCliAccessToken(authHeader: string | null | undefined): string | null {
    return extractBearerCliAccessToken(authHeader);
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
  ) {
    this.tokenRecords = CliDeviceTokenRecordsService.create({ store });
  }

  private readonly tokenRecords: CliDeviceTokenRecordsService;

  /** Every CLI token a person still holds, read through their own index. */
  findTokenRecordsForUser(input: { userId: string }): Promise<CliTokenRecordEntry[]> {
    return this.tokenRecords.findTokenRecordsForUser(input);
  }

  /** Revokes a person's CLI tokens: the named ones inside their index, or all of it. */
  revokeTokens(input: {
    userId: string;
    tokenKeys?: readonly string[] | undefined;
  }): Promise<{ revokedCount: number }> {
    return this.tokenRecords.revokeTokens(input);
  }

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
    const record = raw === undefined ? null : decodeCliSession<CliRefreshTokenRecord>(raw);
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

  /** Drops one refresh token, which is what makes a rejected rotation final. */
  dropRefreshToken(refreshToken: string): Promise<void> {
    return this.store.delete(cliRefreshTokenKey(refreshToken));
  }

  /**
   * The record behind a bearer access token. No bearer, an unknown or
   * unreadable record, or an expired one all throw `CliSessionRecordNotFoundError`.
   */
  async getAccessToken(authHeader: string | null | undefined): Promise<CliAccessTokenRecord> {
    const token = extractBearerCliAccessToken(authHeader);
    if (!token) {
      throw new CliSessionRecordNotFoundError();
    }

    const record = decodeCliSession<CliAccessTokenRecord>(
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
    const token = extractBearerCliAccessToken(input.authHeader);
    if (!token) {
      return;
    }

    await this.store.delete(cliAccessTokenKey(token));
    await this.store.removeFromIndex({
      indexKey: cliUserTokensIndexKey(input.userId),
      memberKey: cliAccessTokenKey(token),
    });
  }

  /** Reads then drops whichever halves of a session a logout named; see the records service. */
  endSession(input: {
    refreshToken?: string | undefined;
    accessToken?: string | undefined;
  }): Promise<(CliRefreshTokenRecord | CliAccessTokenRecord)[]> {
    return this.tokenRecords.endSession(input);
  }
}
