import { describe, expect, it } from "vitest";
import {
  type CachedSession,
  type RevocableSession,
  type SessionRevocationCachePort,
  type SessionRevocationRecordsPort,
  SessionRevocationService,
} from "../session-revocation.service";

/**
 * Ending somebody's sessions, in both stores.
 *
 * With `secondaryStorage` configured, better-auth reads its session cache
 * before the database and short-circuits there, so deleting the Postgres row
 * alone leaves the person signed in until the cached entry expires — up to
 * thirty days. Every case below is about the pair moving together: what the
 * cache lists, what the rows say, and what happens when the two disagree or
 * the cache cannot be reached at all.
 *
 * Driven through the ports with in-memory stores rather than a mocked Prisma
 * client: the decisions under test are the service's, and the queries behind
 * them belong to `PrismaSessionRevocationRecords`.
 */

interface SessionRow {
  id: string;
  sessionToken: string;
  userId: string;
  identifierId: string | null;
}

const sessionRow = ({
  id,
  userId = "sam",
  identifierId = null,
}: {
  id: string;
  userId?: string;
  identifierId?: string | null;
}): SessionRow => ({
  id,
  sessionToken: `token-${id}`,
  userId,
  identifierId,
});

const cached = (token: string): CachedSession => ({
  token,
  expiresAt: 1_800_000_000_000,
});

/**
 * The two stores, in memory. `cacheUnreachable` is the transient Redis
 * failure: every cache call throws, which is what the revocation has to
 * survive.
 */
const revocationOver = ({
  sessions = [],
  index = null,
  cacheUnreachable = false,
}: {
  sessions?: readonly SessionRow[];
  index?: readonly CachedSession[] | null;
  cacheUnreachable?: boolean;
} = {}) => {
  const rows = new Map(sessions.map((session) => [session.id, session]));
  let storedIndex: readonly CachedSession[] | null = index;
  const droppedTokens: string[] = [];

  const refuseCache = (): never => {
    throw new Error("cache unreachable");
  };
  const remove = (matches: (row: SessionRow) => boolean): number => {
    const doomed = [...rows.values()].filter(matches);
    for (const row of doomed) rows.delete(row.id);
    return doomed.length;
  };
  const rowsOf = (userId: string) =>
    [...rows.values()].filter((row) => row.userId === userId);

  const cache: SessionRevocationCachePort = {
    readIndex: async () => (cacheUnreachable ? refuseCache() : storedIndex),
    writeIndex: async ({ sessions: entries }) => {
      if (cacheUnreachable) refuseCache();
      storedIndex = entries;
    },
    dropIndex: async () => {
      if (cacheUnreachable) refuseCache();
      storedIndex = null;
    },
    dropSessions: async ({ tokens }) => {
      if (cacheUnreachable) refuseCache();
      droppedTokens.push(...tokens);
    },
  };

  const records: SessionRevocationRecordsPort = {
    findTokensForUser: async ({ userId }) =>
      rowsOf(userId).map((row) => row.sessionToken),
    findTokensForUserExcept: async ({ userId, keepSessionId }) =>
      rowsOf(userId)
        .filter((row) => row.id !== keepSessionId)
        .map((row) => row.sessionToken),
    findTokenForSession: async ({ sessionId }) =>
      rows.get(sessionId)?.sessionToken ?? null,
    findForIdentifier: async ({ userId, identifierId }) =>
      rowsOf(userId)
        .filter((row) => row.identifierId === identifierId)
        .map(
          ({ id, sessionToken }): RevocableSession => ({ id, sessionToken }),
        ),
    deleteAllForUser: async ({ userId }) =>
      remove((row) => row.userId === userId),
    deleteForUserExcept: async ({ userId, keepSessionId }) =>
      remove((row) => row.userId === userId && row.id !== keepSessionId),
    deleteByIds: async ({ ids }) => remove((row) => ids.includes(row.id)),
    deleteByToken: async ({ token }) =>
      remove((row) => row.sessionToken === token),
  };

  return {
    service: new SessionRevocationService({ records, cache }),
    droppedTokens,
    liveSessionIds: () => [...rows.keys()],
    liveIndex: () => storedIndex,
  };
};

describe("given a person with sessions in both stores", () => {
  describe("when every session is revoked and the cache lists them all", () => {
    it("clears each cached session, drops the index, and deletes the rows", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "a" }), sessionRow({ id: "b" })],
        index: [cached("token-a"), cached("token-b")],
      });

      await stores.service.revokeAll({ userId: "sam" });

      expect(stores.droppedTokens).toEqual(["token-a", "token-b"]);
      expect(stores.liveIndex()).toBeNull();
      expect(stores.liveSessionIds()).toEqual([]);
    });
  });

  describe("when every session is revoked and the cache lists none of them", () => {
    it("falls back to the session rows and clears the cached session behind each", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({ id: "orphan-1" }),
          sessionRow({ id: "orphan-2" }),
        ],
        index: null,
      });

      await stores.service.revokeAll({ userId: "sam" });

      expect(stores.droppedTokens).toEqual([
        "token-orphan-1",
        "token-orphan-2",
      ]);
      expect(stores.liveSessionIds()).toEqual([]);
    });
  });

  describe("when every session is revoked and the cache lists only some of them", () => {
    it("clears the listed ones once and sweeps the rows for the rest", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "listed" }), sessionRow({ id: "missed" })],
        index: [cached("token-listed")],
      });

      await stores.service.revokeAll({ userId: "sam" });

      expect(stores.droppedTokens).toEqual(["token-listed", "token-missed"]);
      expect(stores.liveSessionIds()).toEqual([]);
    });
  });

  describe("when every session is revoked and the cache cannot be reached", () => {
    it("still deletes the rows, so the person is at least revoked in the database", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "a" })],
        cacheUnreachable: true,
      });

      await stores.service.revokeAll({ userId: "sam" });

      expect(stores.liveSessionIds()).toEqual([]);
    });
  });

  describe("when every session is revoked and the person holds none", () => {
    it("completes without raising", async () => {
      const stores = revocationOver();

      await expect(
        stores.service.revokeAll({ userId: "nobody" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when every session is revoked and somebody else holds sessions too", () => {
    /** @scenario "Resetting a password still ends every session" */
    it("ends every session of theirs and nobody else's", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({ id: "password", identifierId: "id_password" }),
          sessionRow({ id: "provider", identifierId: "id_provider" }),
          sessionRow({ id: "before-the-column", identifierId: null }),
          sessionRow({ id: "someone-else", userId: "alex" }),
        ],
      });

      await stores.service.revokeAll({ userId: "sam" });

      // The person, and nothing else. No identifier, no sign-in method: a
      // reset is the recovery path for an account somebody may have lost
      // control of, and narrowing it would leave the attacker's session in
      // place.
      expect(stores.liveSessionIds()).toEqual(["someone-else"]);
    });

    /** @scenario "Resetting a password still ends every session" */
    it("clears the cached session behind every one of them", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({ id: "password", identifierId: "id_password" }),
          sessionRow({ id: "provider", identifierId: "id_provider" }),
          sessionRow({ id: "before-the-column", identifierId: null }),
        ],
      });

      await stores.service.revokeAll({ userId: "sam" });

      expect(stores.droppedTokens).toEqual([
        "token-password",
        "token-provider",
        "token-before-the-column",
      ]);
    });
  });
});

describe("given a person changing their password from one of several devices", () => {
  describe("when the other sessions are revoked", () => {
    it("clears every other cached session and leaves the current one listed", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({ id: "current" }),
          sessionRow({ id: "old-device" }),
          sessionRow({ id: "stolen" }),
        ],
        index: [
          cached("token-current"),
          cached("token-old-device"),
          cached("token-stolen"),
        ],
      });

      await stores.service.revokeOthers({
        userId: "sam",
        keepSessionId: "current",
      });

      expect(stores.droppedTokens).not.toContain("token-current");
      expect(stores.droppedTokens).toContain("token-old-device");
      expect(stores.droppedTokens).toContain("token-stolen");
      expect(stores.liveIndex()).toEqual([cached("token-current")]);
      expect(stores.liveSessionIds()).toEqual(["current"]);
    });
  });

  describe("when the other sessions are revoked and only the current one exists", () => {
    it("leaves the current cached session alone and deletes no rows", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "solo" })],
        index: [cached("token-solo")],
      });

      await stores.service.revokeOthers({
        userId: "sam",
        keepSessionId: "solo",
      });

      expect(stores.droppedTokens).toEqual([]);
      expect(stores.liveIndex()).toEqual([cached("token-solo")]);
      expect(stores.liveSessionIds()).toEqual(["solo"]);
    });
  });

  describe("when the other sessions are revoked and the cache lists none of them", () => {
    it("drops the index and sweeps the rows for the sessions to end", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "current" }), sessionRow({ id: "other" })],
        index: null,
      });

      await stores.service.revokeOthers({
        userId: "sam",
        keepSessionId: "current",
      });

      expect(stores.droppedTokens).toEqual(["token-other"]);
      expect(stores.liveIndex()).toBeNull();
      expect(stores.liveSessionIds()).toEqual(["current"]);
    });
  });

  describe("when the other sessions are revoked and the cache cannot be reached", () => {
    it("still deletes the other rows and keeps the current one", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "current" }), sessionRow({ id: "other" })],
        cacheUnreachable: true,
      });

      await stores.service.revokeOthers({
        userId: "sam",
        keepSessionId: "current",
      });

      expect(stores.liveSessionIds()).toEqual(["current"]);
    });
  });
});

describe("given a person signed in through two different methods", () => {
  describe("when the sessions one method minted are revoked", () => {
    it("ends that method's sessions and leaves the others listed in the cache", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({ id: "passkey", identifierId: "id_passkey" }),
          sessionRow({ id: "password", identifierId: "id_password" }),
        ],
        index: [cached("token-passkey"), cached("token-password")],
      });

      const { ended } = await stores.service.revokeForIdentifier({
        userId: "sam",
        identifierId: "id_passkey",
      });

      expect(ended).toBe(1);
      expect(stores.droppedTokens).toEqual(["token-passkey"]);
      expect(stores.liveIndex()).toEqual([cached("token-password")]);
      expect(stores.liveSessionIds()).toEqual(["password"]);
    });
  });

  describe("when the sessions one method minted are revoked and it minted the only one", () => {
    it("drops the index rather than rewriting it empty", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "only", identifierId: "id_passkey" })],
        index: [cached("token-only")],
      });

      await stores.service.revokeForIdentifier({
        userId: "sam",
        identifierId: "id_passkey",
      });

      expect(stores.liveIndex()).toBeNull();
      expect(stores.liveSessionIds()).toEqual([]);
    });
  });

  describe("when the sessions one method minted are revoked and it minted none", () => {
    it("touches neither store", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "password", identifierId: "id_password" })],
        index: [cached("token-password")],
      });

      const { ended } = await stores.service.revokeForIdentifier({
        userId: "sam",
        identifierId: "id_detached",
      });

      expect(ended).toBe(0);
      expect(stores.droppedTokens).toEqual([]);
      expect(stores.liveIndex()).toEqual([cached("token-password")]);
      expect(stores.liveSessionIds()).toEqual(["password"]);
    });
  });

  describe("when the sessions one method minted are revoked and the identifier is somebody else's", () => {
    it("ends nothing", async () => {
      const stores = revocationOver({
        sessions: [
          sessionRow({
            id: "theirs",
            userId: "alex",
            identifierId: "id_passkey",
          }),
        ],
      });

      const { ended } = await stores.service.revokeForIdentifier({
        userId: "sam",
        identifierId: "id_passkey",
      });

      expect(ended).toBe(0);
      expect(stores.liveSessionIds()).toEqual(["theirs"]);
    });
  });
});

describe("given somebody signing out of the browser they are reading in", () => {
  describe("when that one session is revoked", () => {
    it("deletes the row and clears both the cached session and the index", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "here" }), sessionRow({ id: "elsewhere" })],
        index: [cached("token-here"), cached("token-elsewhere")],
      });

      await stores.service.revokeOne({ token: "token-here", userId: "sam" });

      expect(stores.droppedTokens).toEqual(["token-here"]);
      // The index goes whole rather than being rewritten: it costs one
      // database read on the other device's next request and cannot leave a
      // signed-out token listed as live.
      expect(stores.liveIndex()).toBeNull();
      expect(stores.liveSessionIds()).toEqual(["elsewhere"]);
    });
  });

  describe("when that one session is revoked and its row has already gone", () => {
    it("still clears the cache and completes without raising", async () => {
      const stores = revocationOver({ index: [cached("token-gone")] });

      await expect(
        stores.service.revokeOne({ token: "token-gone", userId: "sam" }),
      ).resolves.toBeUndefined();
      expect(stores.droppedTokens).toEqual(["token-gone"]);
      expect(stores.liveIndex()).toBeNull();
    });
  });

  describe("when that one session is revoked and the cache cannot be reached", () => {
    it("still deletes the row", async () => {
      const stores = revocationOver({
        sessions: [sessionRow({ id: "here" })],
        cacheUnreachable: true,
      });

      await stores.service.revokeOne({ token: "token-here", userId: "sam" });

      expect(stores.liveSessionIds()).toEqual([]);
    });
  });
});
