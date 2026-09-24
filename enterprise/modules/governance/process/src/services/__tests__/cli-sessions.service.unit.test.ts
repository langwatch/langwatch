import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi, CliTokenRecordEntry } from "@langwatch/auth-contract";
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
) {
  const findCliTokenRecordsForUser = vi.fn<AuthApi["findCliTokenRecordsForUser"]>(
    async () => records,
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
});
