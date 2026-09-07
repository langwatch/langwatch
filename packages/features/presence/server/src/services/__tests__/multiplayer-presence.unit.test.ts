/**
 * Multiplayer presence driven over the in-memory repository, which owns the
 * same TTL contract the Redis one implements.
 * @see specs/presence/multiplayer-presence.feature
 */
import {
  presenceUpdateInputSchema,
  type PresenceEvent,
  type PresenceLocation,
} from "@langwatch/presence-contract";
import { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { PresenceBroadcastPort } from "../../ports/presence.port.ts";
import { MemoryPresenceRepository } from "../../repositories/memory/memory.presence.repository.ts";
import { PRESENCE_TTL_SECONDS, PresenceService } from "../presence.service.ts";

const PROJECT = "project-a";

type PublishInput = Parameters<PresenceBroadcastPort["publish"]>[0];

class RecordingBroadcast extends PresenceBroadcastPort {
  readonly publish = vi.fn<(input: PublishInput) => Promise<void>>(async () => undefined);

  events(): PresenceEvent[] {
    return this.publish.mock.calls
      .map(([input]) => input)
      .filter((input) => input.channel === "presence_updated")
      .map((input) => JSON.parse(input.event) as PresenceEvent);
  }
}

function tracesAt(traceId: string | null, panel?: "flame"): PresenceLocation {
  return {
    lens: "traces",
    route: { traceId },
    view: panel ? { panel } : {},
  } as PresenceLocation;
}

function createService() {
  let clockMs = 1_000_000;
  const now = () => clockMs;
  const repository = MemoryPresenceRepository.create({ now });
  const broadcast = new RecordingBroadcast();
  const projects = { isPresenceEnabled: async () => true } as unknown as ProjectService;
  const service = PresenceService.create({ repository, broadcast, projects, now });

  return {
    service,
    repository,
    broadcast,
    advanceSeconds: (seconds: number) => {
      clockMs += seconds * 1_000;
    },
  };
}

function heartbeat(
  user: { id: string; name: string },
  sessionId: string,
  location: PresenceLocation,
) {
  return {
    projectId: PROJECT,
    sessionId,
    user: { id: user.id, name: user.name, image: null },
    location,
  };
}

const alice = { id: "user-alice", name: "Alice" };
const bob = { id: "user-bob", name: "Bob" };

describe("given a project several people are working in", () => {
  describe("when one person opens two browser tabs", () => {
    /** @scenario "A user with two browser tabs has two independent sessions" */
    it("keeps one session per tab, each carrying that tab's own location", async () => {
      const { service } = createService();
      await service.update(heartbeat(alice, "tab-one", tracesAt("T1")));
      await service.update(heartbeat(alice, "tab-two", tracesAt("T2")));

      const sessions = await service.list({ projectId: PROJECT });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((entry) => entry.user.id === alice.id)).toBe(true);
      expect(sessions.map((entry) => entry.location.route.traceId).sort()).toEqual(["T1", "T2"]);
    });
  });

  describe("when a session stops sending heartbeats", () => {
    /** @scenario "A session that stops sending heartbeats expires from presence" */
    it("drops out of the project's session list once its window has passed", async () => {
      const { service, advanceSeconds } = createService();
      await service.update(heartbeat(alice, "tab-one", tracesAt("T1")));

      advanceSeconds(PRESENCE_TTL_SECONDS - 1);
      await expect(service.list({ projectId: PROJECT })).resolves.toHaveLength(1);

      advanceSeconds(2);
      await expect(service.list({ projectId: PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when a client sends a leave signal", () => {
    /** @scenario "Leaving the project removes the session immediately" */
    it("tells peers the session left and removes it before its window expires", async () => {
      const { service, broadcast, advanceSeconds } = createService();
      await service.update(heartbeat(alice, "tab-one", tracesAt("T1")));

      advanceSeconds(1);
      await service.leave({ projectId: PROJECT, sessionId: "tab-one", userId: alice.id });

      expect(broadcast.events().at(-1)).toEqual({ kind: "leave", sessionId: "tab-one" });
      await expect(service.list({ projectId: PROJECT })).resolves.toEqual([]);
    });
  });

  describe("when somebody moves to a different trace", () => {
    /** @scenario "Updating location fans out a single update delta" */
    it("publishes one update carrying the same session id, not a second join", async () => {
      const { service, broadcast } = createService();
      await service.update(heartbeat(bob, "bob-tab", tracesAt(null)));
      await service.update(heartbeat(alice, "tab-one", tracesAt(null)));
      const before = broadcast.events().length;

      await service.update(heartbeat(alice, "tab-one", tracesAt("T1", "flame")));

      const published = broadcast.events().slice(before);
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        kind: "update",
        session: { sessionId: "tab-one", location: { route: { traceId: "T1" } } },
      });
    });
  });

  describe("when a heartbeat repeats the location it already reported", () => {
    /** @scenario "A session that re-reports the same location is a no-op for peers" */
    it("publishes nothing to peers and pushes the expiry window out again", async () => {
      const { service, broadcast, advanceSeconds } = createService();
      const location = tracesAt("T1", "flame");
      await service.update(heartbeat(alice, "tab-one", location));
      const before = broadcast.events().length;

      advanceSeconds(PRESENCE_TTL_SECONDS - 1);
      await service.update(heartbeat(alice, "tab-one", location));

      expect(broadcast.events()).toHaveLength(before);
      advanceSeconds(PRESENCE_TTL_SECONDS - 1);
      await expect(service.list({ projectId: PROJECT })).resolves.toHaveLength(1);
    });
  });

  describe("when a client reports where it is looking", () => {
    /** @scenario "Presence does not transmit cursor coordinates or text selection" */
    it("accepts only the lens, the route and the view", async () => {
      const { service } = createService();
      await service.update(heartbeat(alice, "tab-one", tracesAt("T1", "flame")));

      const [stored] = await service.list({ projectId: PROJECT });
      expect(Object.keys(stored?.location ?? {}).sort()).toEqual(["lens", "route", "view"]);

      for (const rejected of [
        { cursor: { x: 10, y: 20 } },
        { selection: { from: 1, to: 9 } },
        { pointer: "hand" },
      ]) {
        expect(
          presenceUpdateInputSchema.safeParse({
            ...heartbeat(alice, "tab-one", tracesAt("T1")),
            location: { ...tracesAt("T1"), ...rejected },
          }).success,
        ).toBe(false);
      }
    });
  });
});
