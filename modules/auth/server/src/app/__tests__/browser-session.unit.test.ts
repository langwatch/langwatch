import { IdentityEmailService } from "@langwatch/identity-contract";
import { Temporal, type Instant } from "@langwatch/time";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import type { AuthSessionCacheRepository } from "../../repositories/auth-session-cache.repository.ts";
import type {
  AuthSessionRepository,
  StoredBrowserSession,
} from "../../repositories/auth-session.repository.ts";
import { BrowserSessionService } from "../../services/browser-session.service.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const NOW = Temporal.Instant.from("2026-08-28T00:00:00.000Z");
const now = (): Instant => NOW;

/** Every id answers, and `inactive-target` answers as a retired account. */
const users = new TestUserApi({
  tryFindById: async ({ id }: { id: string }): Promise<UserProfile> => ({
    id,
    name: null,
    email: `${id}@example.com`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: id === "inactive-target" ? new Date(0) : null,
  }),
});

class IdentityEmails extends IdentityEmailService {
  constructor(private readonly emails = new Map<string, string | null>()) {
    super();
  }

  async tryResolveEmail({ userId }: { userId: string }): Promise<string | null> {
    return this.emails.get(userId) ?? null;
  }
}

const LIVE_SESSION: StoredBrowserSession = {
  id: "session-1",
  userId: "user-1",
  sessionToken: "token-1",
  impersonating: null,
};

class Sessions implements AuthSessionRepository {
  stored: StoredBrowserSession | null = LIVE_SESSION;
  readonly deletedAll = vi.fn().mockResolvedValue(2);
  readonly deletedById = vi.fn().mockResolvedValue(1);
  readonly deletedOthers = vi.fn().mockResolvedValue(1);

  async findById(): Promise<StoredBrowserSession | null> {
    return this.stored;
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

class Cache implements AuthSessionCacheRepository {
  readonly values = new Map<string, string>();
  readonly deleted = vi.fn();

  async findValue({ key }: { key: string }): Promise<string | null> {
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
    cache?: AuthSessionCacheRepository | null;
    identityEmails?: IdentityEmailService;
  } = {},
) {
  const sessions = options.sessions ?? new Sessions();

  return {
    sessions,
    service: BrowserSessionService.create({
      sessions,
      cache: options.cache === undefined ? new Cache() : options.cache,
      identityEmails: options.identityEmails ?? new IdentityEmails(),
      users,
      now,
    }),
  };
}

/** One stored session carrying the impersonation a case is about. */
function impersonating(value: unknown): Sessions {
  const sessions = new Sessions();
  sessions.stored = { ...LIVE_SESSION, impersonating: value };

  return sessions;
}

const verified = {
  session: { id: "session-1", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
  user: { id: "admin-1", name: "Admin", email: "stale@example.com", image: null },
};

describe("BrowserSessionService", () => {
  describe("when Better Auth answers with a session the database no longer holds", () => {
    /** @scenario "A cached Better Auth session has been revoked" */
    it("fails closed and resolves nobody", async () => {
      const sessions = new Sessions();
      sessions.stored = null;

      await expect(
        service({ sessions }).service.tryResolveBrowserSession({ verified }),
      ).resolves.toBeNull();
    });
  });

  describe("when the identifier ledger holds an address for the person", () => {
    /** @scenario "A finalized user's session carries their identifier address" */
    it("answers the ledger address in the Better Auth session shape", async () => {
      const identityEmails = new IdentityEmails(new Map([["admin-1", "identity@example.com"]]));

      await expect(
        service({ identityEmails }).service.tryResolveBrowserSession({ verified }),
      ).resolves.toMatchObject({
        sessionId: "session-1",
        user: { id: "admin-1", email: "identity@example.com", pendingSsoSetup: false },
      });
    });
  });

  describe("when the identifier ledger holds no address for the person", () => {
    /** @scenario "An unenrolled user's session carries the stored column" */
    it("answers the address stored on the user row, not the one the cookie carried", async () => {
      await expect(
        service().service.tryResolveBrowserSession({ verified }),
      ).resolves.toMatchObject({
        user: { id: "admin-1", email: "admin-1@example.com" },
      });
    });
  });

  describe("when an operator is browsing as somebody", () => {
    /** @scenario "A live admin impersonation acts as its target" */
    it("switches actor only for a live impersonation target", async () => {
      const identityEmails = new IdentityEmails(
        new Map([
          ["admin-1", "admin-identity@example.com"],
          ["target-1", "target-identity@example.com"],
        ]),
      );
      const sessions = impersonating({
        id: "target-1",
        name: "Target",
        email: "target-stale@example.com",
        image: null,
        expires: "2030-01-01T00:00:00.000Z",
      });

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
    ])("keeps the real actor for %s impersonation", async (_label, value) => {
      await expect(
        service({ sessions: impersonating(value) }).service.tryResolveBrowserSession({ verified }),
      ).resolves.toMatchObject({ user: { id: "admin-1" } });
    });
  });

  describe("when a revocation runs against the shared session cache", () => {
    /** @scenario "Revoking other browser sessions retains the current device" */
    it("clears every cached entry but the one device it was told to keep", async () => {
      const cache = new Cache();
      cache.values.set(
        "better-auth:active-sessions-user-1",
        JSON.stringify([
          { token: "token-1", expiresAt: 1 },
          { token: "token-2", expiresAt: 1 },
        ]),
      );
      const { service: auth, sessions } = service({ cache });

      await auth.revokeOtherBrowserSessions({ userId: "user-1", keepSessionId: "session-1" });

      expect(cache.deleted).toHaveBeenCalledWith("better-auth:token-2");
      expect(cache.deleted).not.toHaveBeenCalledWith("better-auth:token-1");
      expect(sessions.deletedOthers).toHaveBeenCalledWith({
        userId: "user-1",
        keepSessionId: "session-1",
      });
    });

    it("falls back to persisted session tokens when the active-session index is malformed", async () => {
      const cache = new Cache();
      cache.values.set("better-auth:active-sessions-user-1", "not-json");
      const { service: auth, sessions } = service({ cache });

      await auth.revokeAllBrowserSessions({ userId: "user-1" });

      expect(cache.deleted).toHaveBeenCalledWith("better-auth:token-1");
      expect(cache.deleted).toHaveBeenCalledWith("better-auth:token-2");
      expect(sessions.deletedAll).toHaveBeenCalledWith({ userId: "user-1" });
    });

    it("still revokes persisted sessions when the cache operation fails", async () => {
      class FailingCache implements AuthSessionCacheRepository {
        async findValue(): Promise<string | null> {
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

      await service({ sessions, cache: new FailingCache() }).service.revokeAllBrowserSessions({
        userId: "user-1",
      });

      expect(sessions.deletedAll).toHaveBeenCalledWith({ userId: "user-1" });
    });
  });

  describe("when the deployment composed no session cache", () => {
    it("revokes the persisted sessions and touches no cache", async () => {
      const sessions = new Sessions();

      await service({ sessions, cache: null }).service.revokeBrowserSession({
        sessionId: "session-1",
      });

      expect(sessions.deletedById).toHaveBeenCalledWith({ id: "session-1" });
    });
  });
});
