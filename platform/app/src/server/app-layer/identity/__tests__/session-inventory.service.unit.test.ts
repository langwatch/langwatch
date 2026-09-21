import { describe, expect, it } from "vitest";
import {
  SessionInventoryService,
  SessionIsCurrentError,
  type SessionRecord,
  type SessionRecordsPort,
} from "../session-inventory.service";
import {
  type SessionRevocationCachePort,
  type SessionRevocationRecordsPort,
  SessionRevocationService,
} from "../session-revocation.service";

const session = ({
  id,
  userId = "ana",
}: {
  id: string;
  userId?: string;
}): SessionRecord & { userId: string } => ({
  id,
  userId,
  sessionToken: `token-${id}`,
  identifierId: "identifier-password",
  amr: ["pwd"],
  ipAddress: null,
  userAgent: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  expires: new Date("2027-01-01T00:00:00.000Z"),
});

const inventoryOver = (
  initial: readonly (SessionRecord & { userId: string })[],
) => {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const droppedTokens: string[] = [];
  const rowsFor = (userId: string) =>
    [...rows.values()].filter((row) => row.userId === userId);

  const records: SessionRecordsPort & SessionRevocationRecordsPort = {
    listForUser: async ({ userId }) =>
      [...rows.values()].filter((row) => row.userId === userId),
    listForIdentifier: async ({ userId, identifierId }) =>
      [...rows.values()].filter(
        (row) => row.userId === userId && row.identifierId === identifierId,
      ),
    findTokensForUser: async ({ userId }) =>
      rowsFor(userId).map((row) => row.sessionToken),
    findTokensForUserExcept: async ({ userId, keepSessionId }) =>
      rowsFor(userId)
        .filter((row) => row.id !== keepSessionId)
        .map((row) => row.sessionToken),
    findTokenForSession: async ({ sessionId }) =>
      rows.get(sessionId)?.sessionToken ?? null,
    findForIdentifier: async ({ userId, identifierId }) =>
      rowsFor(userId)
        .filter((row) => row.identifierId === identifierId)
        .map(({ id, sessionToken }) => ({ id, sessionToken })),
    deleteAllForUser: async ({ userId }) => {
      let ended = 0;
      for (const row of rowsFor(userId)) {
        if (rows.delete(row.id)) ended += 1;
      }
      return ended;
    },
    deleteForUserExcept: async ({ userId, keepSessionId }) => {
      let ended = 0;
      for (const row of rowsFor(userId)) {
        if (row.id !== keepSessionId && rows.delete(row.id)) ended += 1;
      }
      return ended;
    },
    deleteByIds: async ({ ids }) => {
      let ended = 0;
      for (const id of ids) {
        if (rows.delete(id)) ended += 1;
      }
      return ended;
    },
    deleteByToken: async ({ token }) => {
      const row = [...rows.values()].find(
        (candidate) => candidate.sessionToken === token,
      );
      return row && rows.delete(row.id) ? 1 : 0;
    },
  };
  const cache: SessionRevocationCachePort = {
    readIndex: async () => null,
    writeIndex: async () => undefined,
    dropIndex: async () => undefined,
    dropSessions: async ({ tokens }) => {
      droppedTokens.push(...tokens);
    },
  };
  const revocation = new SessionRevocationService({ records, cache });

  return {
    service: new SessionInventoryService({ records, revocation }),
    droppedTokens,
    liveSessionIds: () => [...rows.keys()],
  };
};

describe("SessionInventoryService.endSession", () => {
  /** @scenario "Ending the session doing the asking is refused at the boundary" */
  it("refuses the current session before touching either session store", async () => {
    const stores = inventoryOver([
      session({ id: "current" }),
      session({ id: "other" }),
    ]);

    await expect(
      stores.service.endSession({
        userId: "ana",
        sessionId: "current",
        currentSessionId: "current",
      }),
    ).rejects.toMatchObject({
      code: "session_is_current",
      name: SessionIsCurrentError.name,
    });

    expect(stores.droppedTokens).toEqual([]);
    expect(stores.liveSessionIds()).toEqual(["current", "other"]);
  });

  /** @scenario "Naming somebody else's session ends nothing" */
  it("looks up the named session inside the caller's own rows", async () => {
    const stores = inventoryOver([
      session({ id: "ana-session" }),
      session({ id: "other-session", userId: "olga" }),
    ]);

    await expect(
      stores.service.endSession({
        userId: "ana",
        sessionId: "other-session",
        currentSessionId: "ana-session",
      }),
    ).resolves.toEqual({ ended: 0 });

    expect(stores.droppedTokens).toEqual([]);
    expect(stores.liveSessionIds()).toEqual(["ana-session", "other-session"]);
  });

  it("ends a different session of the caller in both stores", async () => {
    const stores = inventoryOver([
      session({ id: "current" }),
      session({ id: "old-browser" }),
    ]);

    await expect(
      stores.service.endSession({
        userId: "ana",
        sessionId: "old-browser",
        currentSessionId: "current",
      }),
    ).resolves.toEqual({ ended: 1 });

    expect(stores.droppedTokens).toEqual(["token-old-browser"]);
    expect(stores.liveSessionIds()).toEqual(["current"]);
  });
});
