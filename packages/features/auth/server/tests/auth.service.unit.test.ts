import { describe, expect, it, vi } from "vitest";
import { AuthService } from "@langwatch/auth-server";
import type { UserProfile } from "@langwatch/user-contract";
import { UserService } from "@langwatch/user-contract";
import { IdentityEmailService } from "@langwatch/identity";
import { AuthClockPort } from "../src/ports/auth-clock.port";
import { AuthSecondaryStorePort } from "../src/ports/auth-secondary-store.port";
import { AuthSessionRepository } from "../src/repositories/auth-session.repository";

class Clock extends AuthClockPort {
  now(): Date {
    return new Date("2026-08-28T00:00:00.000Z");
  }
}

class Users extends UserService {
  async tryFindById({ id }: { id: string }): Promise<UserProfile | null> {
    return {
      id,
      name: null,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      pendingSsoSetup: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastLoginAt: null,
      deactivatedAt: null,
    };
  }
  async getProfiles(): Promise<never> {
    throw new Error("not used");
  }
  async tryFindByEmail(): Promise<never> {
    throw new Error("not used");
  }
  async create(): Promise<never> {
    throw new Error("not used");
  }
  async createCredentialUser(): Promise<never> {
    throw new Error("not used");
  }
  async createPasskeyUser(): Promise<never> {
    throw new Error("not used");
  }
  async updateProfile(): Promise<never> {
    throw new Error("not used");
  }
  async getAccountInfo(): Promise<never> {
    throw new Error("not used");
  }
  async getSsoStatus(): Promise<never> {
    throw new Error("not used");
  }
  async getTraceExplorerTourPreference(): Promise<never> {
    throw new Error("not used");
  }
  async dismissTraceExplorerTourPreference(): Promise<never> {
    throw new Error("not used");
  }
  async dismissTraceExplorerTour(): Promise<never> {
    throw new Error("not used");
  }
  async updateLastLogin(): Promise<never> {
    throw new Error("not used");
  }
  async tryGetLastHomePath(): Promise<never> {
    throw new Error("not used");
  }
  async setLastHomePath(): Promise<never> {
    throw new Error("not used");
  }
  async deactivate(): Promise<never> {
    throw new Error("not used");
  }
  async reactivate(): Promise<never> {
    throw new Error("not used");
  }
  async setAvatar(): Promise<never> {
    throw new Error("not used");
  }
  async removeAvatar(): Promise<never> {
    throw new Error("not used");
  }
}

class IdentityEmails extends IdentityEmailService {
  constructor(private readonly emails = new Map<string, string | null>()) {
    super();
  }

  async resolveEmail({ userId }: { userId: string }): Promise<string | null> {
    return this.emails.get(userId) ?? null;
  }
}

class Sessions extends AuthSessionRepository {
  stored: { id: string; userId: string; sessionToken: string; impersonating: unknown } | null = {
    id: "session-1",
    userId: "user-1",
    sessionToken: "token-1",
    impersonating: null,
  };
  readonly deletedAll = vi.fn().mockResolvedValue(2);
  readonly deletedById = vi.fn().mockResolvedValue(1);
  readonly deletedOthers = vi.fn().mockResolvedValue(1);
  async tryFindById(): Promise<{
    id: string;
    userId: string;
    sessionToken: string;
    impersonating: unknown;
  } | null> {
    return this.stored;
  }
  async tryFindActiveUser({ id }: { id: string }): Promise<boolean> {
    return id === "target-1";
  }
  async listTokensForUser(): Promise<string[]> {
    return ["token-1", "token-2"];
  }
  deleteAllForUser({ userId }: { userId: string }): Promise<number> {
    return this.deletedAll({ userId });
  }
  deleteById({ id }: { id: string }): Promise<number> {
    return this.deletedById({ id });
  }
  deleteOthersForUser(input: { userId: string; keepSessionId: string }): Promise<number> {
    return this.deletedOthers(input);
  }
}

class Store extends AuthSecondaryStorePort {
  readonly values = new Map<string, string>();
  readonly deleted = vi.fn();
  async get({ key }: { key: string }): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set({ key, value }: { key: string; value: string }): Promise<void> {
    this.values.set(key, value);
  }
  async delete({ key }: { key: string }): Promise<void> {
    this.deleted(key);
    this.values.delete(key);
  }
}

function service(
  options: {
    sessions?: Sessions;
    store?: AuthSecondaryStorePort | null;
    identityEmails?: IdentityEmailService;
  } = {},
) {
  const sessions = options.sessions ?? new Sessions();
  return {
    sessions,
    service: AuthService.create({
      clock: new Clock(),
      repository: sessions,
      secondaryStore: options.store === undefined ? new Store() : options.store,
      identityEmails: options.identityEmails ?? new IdentityEmails(),
      users: new Users(),
    }),
  };
}

const verified = {
  session: { id: "session-1", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
  user: { id: "admin-1", name: "Admin", email: "stale@example.com", image: null },
};

describe("AuthService", () => {
  it("fails closed when Better Auth returns a cached session with no row", async () => {
    const sessions = new Sessions();
    sessions.stored = null;
    await expect(
      service({ sessions }).service.tryResolveBrowserSession({ verified }),
    ).resolves.toBeNull();
  });

  it("preserves the Better Auth-compatible session shape and identity email fork", async () => {
    const identityEmails = new IdentityEmails(new Map([["admin-1", "identity@example.com"]]));
    await expect(
      service({ identityEmails }).service.tryResolveBrowserSession({ verified }),
    ).resolves.toMatchObject({
      sessionId: "session-1",
      user: { id: "admin-1", email: "identity@example.com", pendingSsoSetup: false },
    });
  });

  it("switches actor only for a live impersonation target", async () => {
    const sessions = new Sessions();
    sessions.stored = {
      ...sessions.stored!,
      impersonating: {
        id: "target-1",
        name: "Target",
        email: "target-stale@example.com",
        image: null,
        expires: "2030-01-01T00:00:00.000Z",
      },
    };
    const identityEmails = new IdentityEmails(
      new Map([
        ["admin-1", "admin-identity@example.com"],
        ["target-1", "target-identity@example.com"],
      ]),
    );
    await expect(
      service({ sessions, identityEmails }).service.tryResolveBrowserSession({ verified }),
    ).resolves.toMatchObject({
      user: {
        id: "target-1",
        email: "target-identity@example.com",
        impersonator: { id: "admin-1", email: "admin-identity@example.com" },
      },
    });
  });

  it.each([
    ["malformed", { garbage: true }],
    [
      "expired",
      {
        id: "target-1",
        name: "Target",
        email: "target@example.com",
        image: null,
        expires: "2020-01-01T00:00:00.000Z",
      },
    ],
    [
      "inactive target",
      {
        id: "inactive-target",
        name: "Target",
        email: "target@example.com",
        image: null,
        expires: "2030-01-01T00:00:00.000Z",
      },
    ],
  ])("keeps the real actor for %s impersonation", async (_label, impersonating) => {
    const sessions = new Sessions();
    sessions.stored = { ...sessions.stored!, impersonating };

    await expect(
      service({ sessions }).service.tryResolveBrowserSession({ verified }),
    ).resolves.toMatchObject({
      user: { id: "admin-1" },
    });
  });

  it("clears cached and persisted sessions while retaining a requested current session", async () => {
    const store = new Store();
    store.values.set(
      "better-auth:active-sessions-user-1",
      JSON.stringify([
        { token: "token-1", expiresAt: 1 },
        { token: "token-2", expiresAt: 1 },
      ]),
    );
    const { service: auth, sessions } = service({ store });

    await auth.revokeOtherBrowserSessions({ userId: "user-1", keepSessionId: "session-1" });

    expect(store.deleted).toHaveBeenCalledWith("better-auth:token-2");
    expect(store.deleted).not.toHaveBeenCalledWith("better-auth:token-1");
    expect(sessions.deletedOthers).toHaveBeenCalledWith({
      userId: "user-1",
      keepSessionId: "session-1",
    });
  });

  it("falls back to persisted session tokens when the active-session index is malformed", async () => {
    const store = new Store();
    store.values.set("better-auth:active-sessions-user-1", "not-json");
    const { service: auth, sessions } = service({ store });

    await auth.revokeAllBrowserSessions({ userId: "user-1" });

    expect(store.deleted).toHaveBeenCalledWith("better-auth:token-1");
    expect(store.deleted).toHaveBeenCalledWith("better-auth:token-2");
    expect(sessions.deletedAll).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("still revokes persisted sessions when the cache operation fails", async () => {
    class FailingStore extends AuthSecondaryStorePort {
      async get(): Promise<string | null> {
        throw new Error("redis unavailable");
      }
      async set(): Promise<void> {
        throw new Error("not reached");
      }
      async delete(): Promise<void> {
        throw new Error("not reached");
      }
    }
    const sessions = new Sessions();

    await service({ sessions, store: new FailingStore() }).service.revokeAllBrowserSessions({
      userId: "user-1",
    });

    expect(sessions.deletedAll).toHaveBeenCalledWith({ userId: "user-1" });
  });
});
