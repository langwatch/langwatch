import {
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserTokensIndexKey,
  type CliTokenRecordEntry,
} from "@langwatch/auth-contract";

import type { CliDeviceSessionRepository } from "../repositories/cli-device-session.repository.ts";
import {
  decodeCliSession,
  familyIndexKey,
  isRecordNotFound,
  toTokenRecordEntry,
  type CliAccessTokenRecord,
  type CliRefreshTokenRecord,
} from "../rules/cli-device-session.rules.ts";

/** A person's CLI tokens: what they still hold, and ending them with the forks beneath. */
export class CliDeviceTokenRecordsService {
  static create({ store }: { store: CliDeviceSessionRepository }): CliDeviceTokenRecordsService {
    return new CliDeviceTokenRecordsService(store);
  }

  private constructor(private readonly store: CliDeviceSessionRepository) {}

  /**
   * Ends every child forked from these sessions' families, answering how many records were held.
   */
  async endChildren(records: readonly Pick<CliRefreshTokenRecord, "family_id">[]): Promise<number> {
    let ended = 0;
    for (const familyId of new Set(records.flatMap(({ family_id }) => family_id ?? []))) {
      const indexKey = familyIndexKey(familyId);
      const memberKeys = await this.store.findIndexedTokens(indexKey);
      ended += await this.store.deleteIndexedTokens({ indexKey, memberKeys });
    }

    return ended;
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
          : decodeCliSession<CliAccessTokenRecord | CliRefreshTokenRecord>(raw);
      if (!record || record.user_id !== userId) continue;

      entries.push(toTokenRecordEntry({ tokenKey, record }));
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
      const record = raw === undefined ? null : decodeCliSession<CliRefreshTokenRecord>(raw);
      if (record) parents.push(record);
    }
    // A revoked session's forks go with it.
    const children = await this.endChildren(parents);
    return {
      revokedCount: children + (await this.store.deleteIndexedTokens({ indexKey, memberKeys })),
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
