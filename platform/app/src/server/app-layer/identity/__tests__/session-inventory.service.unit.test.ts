import { describe, expect, it } from "vitest";
import {
  type SessionCachePort,
  type SessionRecord,
  type SessionRecordsPort,
  SessionInventoryService,
  SessionIsCurrentError,
} from "../session-inventory.service";

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

  const records: SessionRecordsPort = {
    listForUser: async ({ userId }) =>
      [...rows.values()].filter((row) => row.userId === userId),
    listForIdentifier: async ({ userId, identifierId }) =>
      [...rows.values()].filter(
        (row) =>
          row.userId === userId && row.identifierId === identifierId,
      ),
    deleteByIds: async ({ ids }) => {
      let ended = 0;
      for (const id of ids) {
        if (rows.delete(id)) {
          ended += 1;
        }
      }
      return ended;
    },
  };
  const cache: SessionCachePort = {
    dropTokens: async ({ tokens }) => {
      droppedTokens.push(...tokens);
    },
  };

  return {
    service: new SessionInventoryService({ records, cache }),
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
