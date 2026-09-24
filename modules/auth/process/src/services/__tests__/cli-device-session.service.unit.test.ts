/**
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import {
  cliAccessTokenKey,
  cliRefreshTokenKey,
  cliUserTokensIndexKey,
} from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import { MemoryCliDeviceSessionRepository } from "../../repositories/memory/memory.cli-device-session.repository.ts";
import { CliDeviceSessionService } from "../cli-device-session.service.ts";

function setup() {
  const store = MemoryCliDeviceSessionRepository.create();
  return { store, sessions: CliDeviceSessionService.create({ store }) };
}

const clientInfo = { hostname: "host", platform: "darwin", session_started_at: 100 };

describe("the CLI token records a peer reads and revokes", () => {
  describe("when a person holds a minted CLI session", () => {
    it("answers both of its tokens with the device facts it was minted with", async () => {
      const { sessions } = setup();
      const minted = await sessions.mintSession({
        userId: "alice",
        organizationId: "org",
        clientInfo,
      });

      const records = await sessions.findTokenRecordsForUser({ userId: "alice" });

      expect(records.map(({ tokenKey }) => tokenKey).toSorted()).toEqual(
        [cliAccessTokenKey(minted.accessToken), cliRefreshTokenKey(minted.refreshToken)].toSorted(),
      );
      for (const record of records) {
        expect(record).toMatchObject({
          organizationId: "org",
          clientInfo: { hostname: "host", platform: "darwin", sessionStartedAtMs: 100 },
        });
      }
    });

    it("names the login key the session minted, so revoking the session can retire it", async () => {
      const { sessions } = setup();
      await sessions.mintSession({
        userId: "alice",
        organizationId: "org",
        clientInfo,
        cliApiKeyId: "ak_login",
      });

      const records = await sessions.findTokenRecordsForUser({ userId: "alice" });

      expect(records.map(({ cliApiKeyId }) => cliApiKeyId)).toEqual(["ak_login", "ak_login"]);
    });

    it("answers nothing to anybody else", async () => {
      const { sessions } = setup();
      await sessions.mintSession({ userId: "alice", organizationId: "org", clientInfo });

      expect(await sessions.findTokenRecordsForUser({ userId: "bob" })).toEqual([]);
    });
  });

  describe("when the index names a token whose record has lapsed", () => {
    it("skips the lapsed token and counts only the live ones on revocation", async () => {
      const { store, sessions } = setup();
      await sessions.mintSession({ userId: "alice", organizationId: "org", clientInfo });
      await store.indexTokens({
        indexKey: cliUserTokensIndexKey("alice"),
        memberKeys: [cliAccessTokenKey("lapsed")],
        ttlMs: 60_000,
      });

      expect(await sessions.findTokenRecordsForUser({ userId: "alice" })).toHaveLength(2);
      expect(await sessions.revokeTokens({ userId: "alice" })).toEqual({ revokedCount: 2 });
      expect(await store.findIndexedTokens(cliUserTokensIndexKey("alice"))).toEqual([]);
    });
  });

  describe("when every token a person holds is revoked", () => {
    /** @scenario After deactivation, /refresh returns 401 for the revoked refresh_token */
    it("drops both records, so the refresh token no longer rotates", async () => {
      const { sessions } = setup();
      const minted = await sessions.mintSession({
        userId: "alice",
        organizationId: "org",
        clientInfo,
      });

      expect(await sessions.revokeTokens({ userId: "alice" })).toEqual({ revokedCount: 2 });
      await expect(sessions.getRefreshToken(minted.refreshToken)).rejects.toMatchObject({
        code: "cli_device_flow_refused",
      });
      expect(await sessions.findTokenRecordsForUser({ userId: "alice" })).toEqual([]);
    });

    it("answers zero for a person who never signed in from the CLI", async () => {
      const { sessions } = setup();

      expect(await sessions.revokeTokens({ userId: "alice" })).toEqual({ revokedCount: 0 });
    });
  });

  describe("when named tokens are revoked", () => {
    it("revokes only the named tokens inside the person's own index", async () => {
      const { sessions } = setup();
      const alice = await sessions.mintSession({ userId: "alice", organizationId: "org" });
      const aliceAccess = cliAccessTokenKey(alice.accessToken);

      expect(await sessions.revokeTokens({ userId: "bob", tokenKeys: [aliceAccess] })).toEqual({
        revokedCount: 0,
      });
      expect(await sessions.revokeTokens({ userId: "alice", tokenKeys: [aliceAccess] })).toEqual({
        revokedCount: 1,
      });
      expect(
        (await sessions.findTokenRecordsForUser({ userId: "alice" })).map(
          ({ tokenKey }) => tokenKey,
        ),
      ).toEqual([cliRefreshTokenKey(alice.refreshToken)]);
    });
  });
});
