import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi, CliTokenRecordEntry } from "@langwatch/auth-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { DefaultGovernanceCliSessionInventoryService } from "../cli-session-inventory.service.ts";

const records: CliTokenRecordEntry[] = [
  {
    tokenKey: "lwcli:access:a",
    organizationId: "org",
    cliApiKeyId: "ak_login",
    issuedAtMs: 200,
    expiresAtMs: 300,
    clientInfo: { hostname: "host", platform: "darwin", sessionStartedAtMs: 100 },
  },
  {
    tokenKey: "lwcli:refresh:r",
    organizationId: "org",
    issuedAtMs: 100,
    expiresAtMs: 1_000,
    clientInfo: { sessionStartedAtMs: 100 },
  },
];

function inventory(
  revokeCliSessionKey: ApiKeyApi["revokeCliSessionKey"] = async () => ({
    loginKeyRevoked: true,
    ingestKeysRevoked: 2,
  }),
  tokenRecords: CliTokenRecordEntry[] = records,
) {
  const findCliTokenRecordsForUser = vi.fn<AuthApi["findCliTokenRecordsForUser"]>(
    async () => tokenRecords,
  );
  const revokeCliTokens = vi.fn<AuthApi["revokeCliTokens"]>(async ({ tokenKeys }) => ({
    revokedCount: tokenKeys?.length ?? 0,
  }));
  const loginKeyRevoke = vi.fn(revokeCliSessionKey);
  const service = DefaultGovernanceCliSessionInventoryService.create({
    auth: createApiFixture<AuthApi>({ findCliTokenRecordsForUser, revokeCliTokens }),
    loginKeys: createApiFixture<ApiKeyApi>({ revokeCliSessionKey: loginKeyRevoke }),
  });
  return { service, findCliTokenRecordsForUser, revokeCliTokens, loginKeyRevoke };
}

describe("the governance CLI session inventory", () => {
  it("groups rotated tokens into one device session", async () => {
    const { service, findCliTokenRecordsForUser } = inventory();

    const sessions = await service.listForUser({ userId: "user" });

    expect(findCliTokenRecordsForUser).toHaveBeenCalledWith({ userId: "user" });
    expect(sessions).toEqual([
      {
        sessionStartedAtMs: 100,
        deviceLabel: "Mac (host)",
        hostname: "host",
        uname: null,
        platform: "darwin",
        organizationId: "org",
        cliApiKeyId: "ak_login",
        lastSeenMs: 200,
        expiresAtMs: 1_000,
        tokenKeys: ["lwcli:access:a", "lwcli:refresh:r"],
      },
    ]);
  });

  /** @scenario Revoking a device from the devices tab retires its login key and its ingest keys */
  it("revokes one session by asking auth for exactly its tokens", async () => {
    const { service, revokeCliTokens } = inventory();

    const result = await service.revokeSession({ userId: "user", sessionStartedAtMs: 100 });

    expect(result).toEqual({ revokedTokens: 2, revokedKeys: 3 });
    expect(revokeCliTokens).toHaveBeenCalledWith({
      userId: "user",
      tokenKeys: ["lwcli:access:a", "lwcli:refresh:r"],
    });
  });

  it("revokes nothing for a session the person does not hold", async () => {
    const { service, revokeCliTokens } = inventory();

    const result = await service.revokeSession({ userId: "user", sessionStartedAtMs: 999 });

    expect(result).toEqual({ revokedTokens: 0, revokedKeys: 0 });
    expect(revokeCliTokens).not.toHaveBeenCalled();
  });

  /** @scenario Revoking a device from the devices tab retires its login key and its ingest keys */
  it("retires the session's login key through api-key, as main's revoke did", async () => {
    const { service, loginKeyRevoke } = inventory();

    await service.revokeSession({ userId: "user", sessionStartedAtMs: 100 });

    expect(loginKeyRevoke).toHaveBeenCalledWith({
      apiKeyId: "ak_login",
      userId: "user",
      organizationId: "org",
    });
  });

  it("still ends the session when its login key cannot be retired", async () => {
    const { service } = inventory(async () => {
      throw new Error("api-key unavailable");
    });

    await expect(
      service.revokeSession({ userId: "user", sessionStartedAtMs: 100 }),
    ).resolves.toEqual({ revokedTokens: 2, revokedKeys: 0 });
  });

  it("revokes every session: each login key, then all of the person's tokens", async () => {
    const { service, revokeCliTokens } = inventory();

    await expect(service.revokeAllSessions({ userId: "user" })).resolves.toEqual({
      revokedTokens: 0,
      revokedKeys: 3,
    });
    expect(revokeCliTokens).toHaveBeenCalledWith({ userId: "user" });
  });

  describe("when jane holds a laptop and a desktop session and revokes every device", () => {
    const device = ({ key, startedAtMs }: { key: string; startedAtMs: number }) => ({
      tokenKey: `lwcli:access:${key}`,
      organizationId: "org",
      cliApiKeyId: `login_${key}`,
      issuedAtMs: startedAtMs,
      expiresAtMs: 1_000,
      clientInfo: { sessionStartedAtMs: startedAtMs },
    });

    /** @scenario Revoking every device retires every session's keys */
    it("asks api-key to retire each session's login key and the ingest keys under it", async () => {
      const retired: string[] = [];
      const { service, revokeCliTokens } = inventory(
        async ({ apiKeyId }) => {
          retired.push(apiKeyId);
          return { loginKeyRevoked: true, ingestKeysRevoked: 1 };
        },
        [device({ key: "laptop", startedAtMs: 100 }), device({ key: "desktop", startedAtMs: 200 })],
      );

      await expect(service.revokeAllSessions({ userId: "jane" })).resolves.toEqual({
        revokedTokens: 0,
        revokedKeys: 4,
      });

      expect(retired.toSorted()).toEqual(["login_desktop", "login_laptop"]);
      expect(revokeCliTokens).toHaveBeenCalledWith({ userId: "jane" });
    });
  });
});
