import { beforeEach, describe, expect, it } from "vitest";

import type { BroadcastService } from "../../broadcast/broadcast.service";
import { PresenceService } from "../presence.service";
import { InMemoryPresenceRepository } from "../repositories/presence.memory.repository";
import type { PresenceEvent, PresenceLocation, PresenceUser } from "../types";

// ---------------------------------------------------------------------------
// The real PresenceService runs against the real InMemoryPresenceRepository —
// only the fan-out boundary (BroadcastService) and the clock are simulated, so
// join / update / leave deltas are observed exactly as a subscriber would.
// ---------------------------------------------------------------------------

interface RecordedBroadcast {
  tenantId: string;
  eventType: string;
  event: PresenceEvent;
}

interface RecordedCursor {
  tenantId: string;
  eventType: string;
  event: Record<string, unknown>;
}

function fakeBroadcast() {
  const presence: RecordedBroadcast[] = [];
  const cursors: RecordedCursor[] = [];

  const service = {
    broadcastToTenant: async (
      tenantId: string,
      event: string,
      eventType: string,
    ) => {
      presence.push({
        tenantId,
        eventType,
        event: JSON.parse(event) as PresenceEvent,
      });
    },
    broadcastToTenantRateLimited: async (
      tenantId: string,
      event: string,
      eventType: string,
    ) => {
      cursors.push({
        tenantId,
        eventType,
        event: JSON.parse(event) as Record<string, unknown>,
      });
    },
  } as unknown as BroadcastService;

  return { service, presence, cursors };
}

const ALICE: PresenceUser = {
  id: "user_alice",
  name: "Alice",
  image: null,
};
const BOB: PresenceUser = { id: "user_bob", name: "Bob", image: null };

function locationAt(
  overrides: Partial<PresenceLocation> = {},
): PresenceLocation {
  return {
    lens: "traces",
    route: {},
    ...overrides,
  };
}

describe("PresenceService", () => {
  let clock: number;
  let repository: InMemoryPresenceRepository;
  let broadcast: ReturnType<typeof fakeBroadcast>;
  let service: PresenceService;

  const TTL_SECONDS = 30;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    repository = new InMemoryPresenceRepository({ now: () => clock });
    broadcast = fakeBroadcast();
    service = new PresenceService(
      repository,
      broadcast.service,
      {
        getPresenceConfig: async () => ({
          orgEnabled: true,
          projectEnabled: true,
        }),
      },
      TTL_SECONDS,
    );
  });

  describe("given sessions exist in two different projects", () => {
    describe("when the sessions of one project are read", () => {
      /** @scenario Presence is scoped to a single project */
      it("returns only that project's sessions", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });
        await service.update({
          projectId: "project_b",
          sessionId: "bob_tab_1",
          user: BOB,
          location: locationAt(),
        });

        const projectA = await service.getByProject("project_a");

        expect(projectA.map((session) => session.user.id)).toEqual([ALICE.id]);
        expect(projectA.map((session) => session.sessionId)).not.toContain(
          "bob_tab_1",
        );
      });
    });
  });

  describe("given one user is present in a project from two browser tabs", () => {
    describe("when the project's sessions are read", () => {
      /** @scenario A user with two browser tabs has two independent sessions */
      it("returns one entry per tab, each carrying that tab's own location", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt({ route: { traceId: "trace_1" } }),
        });
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_2",
          user: ALICE,
          location: locationAt({ route: { traceId: "trace_2" } }),
        });

        const sessions = await service.getByProject("project_a");

        expect(sessions).toHaveLength(2);
        expect(sessions.every((session) => session.user.id === ALICE.id)).toBe(
          true,
        );
        expect(
          sessions.map((session) => session.location.route?.traceId).sort(),
        ).toEqual(["trace_1", "trace_2"]);
      });
    });
  });

  describe("given a project with an existing subscriber", () => {
    describe("when a new session reports its location for the first time", () => {
      /** @scenario Joining a project announces the new session to subscribers */
      it("broadcasts a join delta carrying the session and its location", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt({ route: { traceId: "trace_1" } }),
        });

        expect(broadcast.presence).toHaveLength(1);
        const [delta] = broadcast.presence;
        expect(delta?.tenantId).toBe("project_a");
        expect(delta?.event.kind).toBe("join");
        if (delta?.event.kind !== "join") throw new Error("expected join");
        expect(delta.event.session.sessionId).toBe("alice_tab_1");
        expect(delta.event.session.user.id).toBe(ALICE.id);
        expect(delta.event.session.location.route?.traceId).toBe("trace_1");
      });
    });
  });

  describe("given two users already have active presence in a project", () => {
    describe("when the project snapshot is read", () => {
      it("returns both existing sessions", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });
        await service.update({
          projectId: "project_a",
          sessionId: "bob_tab_1",
          user: BOB,
          location: locationAt(),
        });

        const snapshot = await service.getByProject("project_a");

        expect(snapshot.map((session) => session.user.id).sort()).toEqual([
          ALICE.id,
          BOB.id,
        ]);
      });
    });
  });

  describe("given a session that stops sending heartbeats", () => {
    describe("when more than the TTL elapses", () => {
      /** @scenario A session that stops sending heartbeats expires from presence */
      it("drops the session from the project's session list", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });
        expect(await service.getByProject("project_a")).toHaveLength(1);

        clock += (TTL_SECONDS + 1) * 1000;

        expect(await service.getByProject("project_a")).toEqual([]);
      });
    });

    describe("when the TTL has not yet elapsed", () => {
      it("keeps the session visible", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });

        clock += (TTL_SECONDS - 1) * 1000;

        expect(await service.getByProject("project_a")).toHaveLength(1);
      });
    });
  });

  describe("given an active session", () => {
    describe("when its client sends a leave signal", () => {
      /** @scenario Leaving the project removes the session immediately */
      it("broadcasts a leave delta and removes the session before TTL expiry", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });

        await service.leave({
          projectId: "project_a",
          sessionId: "alice_tab_1",
        });

        const leaveDeltas = broadcast.presence.filter(
          (entry) => entry.event.kind === "leave",
        );
        expect(leaveDeltas).toHaveLength(1);
        expect(leaveDeltas[0]?.event).toMatchObject({
          kind: "leave",
          sessionId: "alice_tab_1",
        });
        // Still well inside the TTL window, yet already gone.
        expect(await service.getByProject("project_a")).toEqual([]);
      });
    });

    describe("when leave is called twice for the same session", () => {
      it("stays silent the second time", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt(),
        });
        await service.leave({
          projectId: "project_a",
          sessionId: "alice_tab_1",
        });
        await service.leave({
          projectId: "project_a",
          sessionId: "alice_tab_1",
        });

        expect(
          broadcast.presence.filter((entry) => entry.event.kind === "leave"),
        ).toHaveLength(1);
      });
    });
  });

  describe("given a session already known to its peers", () => {
    describe("when it moves to a different location", () => {
      /** @scenario Updating location fans out a single update delta */
      it("fans out exactly one update delta naming the same session id", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt({ lens: "traces", route: {} }),
        });
        broadcast.presence.length = 0;

        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt({
            route: { traceId: "trace_1" },
            view: { panel: "flame" },
          }),
        });

        expect(broadcast.presence).toHaveLength(1);
        const [delta] = broadcast.presence;
        expect(delta?.event.kind).toBe("update");
        if (delta?.event.kind !== "update") throw new Error("expected update");
        expect(delta.event.session.sessionId).toBe("alice_tab_1");
        expect(delta.event.session.location.route?.traceId).toBe("trace_1");
        expect(delta.event.session.location.view?.panel).toBe("flame");
      });
    });

    describe("when it re-reports the identical location as a heartbeat", () => {
      /** @scenario A session that re-reports the same location is a no-op for peers */
      it("sends no delta but still refreshes the TTL", async () => {
        const location = locationAt({
          route: { traceId: "trace_1" },
          view: { panel: "flame" },
        });
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location,
        });
        broadcast.presence.length = 0;

        // Heartbeat late in the TTL window with an identical location.
        clock += (TTL_SECONDS - 1) * 1000;
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: { ...location },
        });

        expect(broadcast.presence).toEqual([]);

        // Past the original expiry, but the heartbeat re-armed the TTL.
        clock += 2 * 1000;
        expect(await service.getByProject("project_a")).toHaveLength(1);
      });
    });
  });

  describe("given an active session", () => {
    describe("when its client sends a cursor tick", () => {
      /** @scenario Cursor ticks are relayed to peers but never stored in presence */
      it("relays the coordinates on the cursor channel while the stored session keeps none", async () => {
        await service.update({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          location: locationAt({ route: { traceId: "trace_1" } }),
        });

        await service.broadcastCursor({
          projectId: "project_a",
          sessionId: "alice_tab_1",
          user: ALICE,
          payload: { anchor: "trace:trace_1:panel:flame", x: 0.25, y: 0.75 },
        });

        expect(broadcast.cursors).toHaveLength(1);
        expect(broadcast.cursors[0]?.eventType).toBe("presence_cursor");
        expect(broadcast.cursors[0]?.event).toMatchObject({
          anchor: "trace:trace_1:panel:flame",
          x: 0.25,
          y: 0.75,
          sessionId: "alice_tab_1",
        });

        const [stored] = await service.getByProject("project_a");
        const locationKeys = Object.keys(stored?.location ?? {});
        expect(locationKeys.sort()).toEqual(["lens", "route"]);
        expect(JSON.stringify(stored)).not.toContain("anchor");
      });
    });
  });
});
