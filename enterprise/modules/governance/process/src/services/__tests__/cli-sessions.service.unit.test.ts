import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi, CliTokenRecordEntry } from "@langwatch/auth-contract";
import { describe, expect, it, vi } from "vitest";

import { DefaultGovernanceCliSessionInventoryService } from "../cli-session-inventory.service.ts";

const records: CliTokenRecordEntry[] = [
  {
    tokenKey: "lwcli:access:a",
    organizationId: "org",
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

function inventory() {
  const findCliTokenRecordsForUser = vi.fn<AuthApi["findCliTokenRecordsForUser"]>(
    async () => records,
  );
  const revokeCliTokens = vi.fn<AuthApi["revokeCliTokens"]>(async ({ tokenKeys }) => ({
    revokedCount: tokenKeys?.length ?? 0,
  }));
  const service = DefaultGovernanceCliSessionInventoryService.create({
    auth: createApiFixture<AuthApi>({ findCliTokenRecordsForUser, revokeCliTokens }),
  });
  return { service, findCliTokenRecordsForUser, revokeCliTokens };
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
        lastSeenMs: 200,
        expiresAtMs: 1_000,
        tokenKeys: ["lwcli:access:a", "lwcli:refresh:r"],
      },
    ]);
  });

  it("revokes one session by asking auth for exactly its tokens", async () => {
    const { service, revokeCliTokens } = inventory();

    const result = await service.revokeSession({ userId: "user", sessionStartedAtMs: 100 });

    expect(result).toEqual({ revokedTokens: 2 });
    expect(revokeCliTokens).toHaveBeenCalledWith({
      userId: "user",
      tokenKeys: ["lwcli:access:a", "lwcli:refresh:r"],
    });
  });

  it("revokes nothing for a session the person does not hold", async () => {
    const { service, revokeCliTokens } = inventory();

    const result = await service.revokeSession({ userId: "user", sessionStartedAtMs: 999 });

    expect(result).toEqual({ revokedTokens: 0 });
    expect(revokeCliTokens).not.toHaveBeenCalled();
  });
});
