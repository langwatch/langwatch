import { describe, expect, it, vi } from "vitest";
import { CliTokenStorePort } from "../src/ports/cli-token-store.port";
import { DefaultGovernanceCliSessionInventoryService } from "../src/services/cli-session-inventory.service";
import { DefaultGovernanceCliTokenRevocationService } from "../src/services/cli-token-revocation.service";

class MemoryTokenStore extends CliTokenStorePort {
  readonly values = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  members(key: string): Promise<string[]> {
    return Promise.resolve(Array.from(this.sets.get(key) ?? []));
  }
  tryGet(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  delete(key: string): Promise<number> {
    const deleted = this.values.delete(key) || this.sets.delete(key);
    return Promise.resolve(deleted ? 1 : 0);
  }
  removeMembers(key: string, members: string[]): Promise<number> {
    const set = this.sets.get(key);
    let deleted = 0;
    for (const member of members) if (set?.delete(member)) deleted += 1;
    return Promise.resolve(deleted);
  }
}

function seed(store: MemoryTokenStore): void {
  store.sets.set(
    "lwcli:user:user:tokens",
    new Set(["lwcli:access:a", "lwcli:refresh:r", "stale"]),
  );
  store.values.set(
    "lwcli:access:a",
    JSON.stringify({
      user_id: "user",
      organization_id: "org",
      issued_at: 200,
      expires_at: 300,
      client_info: {
        hostname: "host",
        platform: "darwin",
        session_started_at: 100,
      },
    }),
  );
  store.values.set(
    "lwcli:refresh:r",
    JSON.stringify({
      user_id: "user",
      organization_id: "org",
      issued_at: 100,
      expires_at: 1_000,
      client_info: { session_started_at: 100 },
    }),
  );
}

describe("governance CLI session services", () => {
  it("groups rotated tokens into one portable device session", async () => {
    const store = new MemoryTokenStore();
    seed(store);
    const sessions = await DefaultGovernanceCliSessionInventoryService.create({
      store,
    }).listForUser({ userId: "user" });
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

  it("revokes one session and scrubs its index members", async () => {
    const store = new MemoryTokenStore();
    seed(store);
    const result = await DefaultGovernanceCliSessionInventoryService.create({
      store,
    }).revokeSession({ userId: "user", sessionStartedAtMs: 100 });
    expect(result).toEqual({ revokedTokens: 2 });
    expect(await store.members("lwcli:user:user:tokens")).toEqual(["stale"]);
  });

  it("uses cluster-safe per-key deletes for user-wide revocation", async () => {
    const store = new MemoryTokenStore();
    seed(store);
    const deleteSpy = vi.spyOn(store, "delete");
    const result = await DefaultGovernanceCliTokenRevocationService.create({
      store,
    }).revokeForUser({ userId: "user" });
    expect(result).toEqual({ revokedCount: 2 });
    expect(deleteSpy).toHaveBeenCalledWith("lwcli:access:a");
    expect(deleteSpy).toHaveBeenCalledWith("lwcli:refresh:r");
    expect(deleteSpy).toHaveBeenCalledWith("lwcli:user:user:tokens");
  });
});
