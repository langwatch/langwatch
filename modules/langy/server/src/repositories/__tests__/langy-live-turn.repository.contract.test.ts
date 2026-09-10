/**
 * @vitest-environment node
 * The contract every langy live-turn backend answers the same way, stated once
 * and run against each backend the package can reach. The memory tier runs it
 * always; a Redis backend joins the table as a second row when this package
 * declares that datastore.
 */
import { describe, expect, it } from "vitest";
import { instantiateRepositories } from "@langwatch/runtime-composition";
import type { LangyTurnHandoff } from "../langy-live-turn.repository.ts";
import type { ConnectedWorkspace } from "../langy-local-presence.repository.ts";
import {
  type LangyRepositories,
  langyRepositories,
} from "../langy-repositories.registry.ts";
import { MemoryLangyRepositories } from "../memory/memory.langy.repositories.ts";

const backends: ReadonlyArray<{ name: string; create: () => LangyRepositories }> = [
  { name: "memory", create: () => MemoryLangyRepositories.create() },
];

const turn = { conversationId: "conv_1", turnId: "turn_1" } as const;

function accessFor(userId: string): {
  projectId: string;
  conversationId: string;
  turnId: string;
  userId: string;
} {
  return { projectId: "proj_1", ...turn, userId };
}

function handoffFor(actorUserId: string): LangyTurnHandoff {
  return {
    projectId: "proj_1",
    ...turn,
    actorUserId,
    prompt: "summarise the run",
    system: "you are langy",
    credentials: {
      llmVirtualKey: "vk_1",
      langwatchEndpoint: "https://api.example.test",
      gatewayBaseUrl: "https://gateway.example.test",
      organizationId: "org_1",
    },
    runToken: "run_1",
    permitReserved: true,
  };
}

function workspaceFor(instanceId: string): ConnectedWorkspace {
  return {
    conversationId: turn.conversationId,
    projectId: "proj_1",
    userId: "user_1",
    requestId: "req_1",
    instanceId,
    hostname: "laptop.local",
    connectedAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    workspace: { root: "/home/sam/work", name: "work", os: "darwin" },
  };
}

describe.each(backends)("given the $name langy repositories", ({ create }) => {
  describe("when a turn's actor is recorded", () => {
    it("answers that the recorded actor may watch the turn, and no one else", async () => {
      const repositories = create();

      await repositories.turnAccess.grant(accessFor("user_1"));

      expect(await repositories.turnAccess.isTurnActor(accessFor("user_1"))).toBe(true);
      expect(await repositories.turnAccess.isTurnActor(accessFor("user_2"))).toBe(false);
    });
  });

  describe("when a handoff is parked for a worker", () => {
    it("reads back the handoff that was stashed", async () => {
      const repositories = create();

      await repositories.turnHandoff.stash(handoffFor("user_1"));

      expect(await repositories.turnHandoff.read(turn)).toEqual(handoffFor("user_1"));
      expect(await repositories.turnHandoff.refresh(turn)).toBe(true);
    });

    it("answers that a turn is stopped only once the stop is recorded", async () => {
      const repositories = create();

      expect(await repositories.turnHandoff.isStopped(turn)).toBe(false);

      await repositories.turnHandoff.markStopped(turn);

      expect(await repositories.turnHandoff.isStopped(turn)).toBe(true);
    });
  });

  describe("when the same frame nonce arrives twice", () => {
    it("reserves it for the first arrival only", async () => {
      const repositories = create();
      const frame = { ...turn, frameNonce: "nonce_1" };

      expect(await repositories.frameDedup.reserveFrameNonce(frame)).toBe(true);
      expect(await repositories.frameDedup.reserveFrameNonce(frame)).toBe(false);
    });
  });

  describe("when a conversation's links are remembered", () => {
    it("resolves a remembered id and answers nothing for an unknown one", async () => {
      const repositories = create();

      await repositories.resourceLinks.remember({
        conversationId: turn.conversationId,
        links: [{ id: "link_1", href: "/traces/trace_1" }],
      });

      expect(
        await repositories.resourceLinks.resolve({
          conversationId: turn.conversationId,
          id: "link_1",
        }),
      ).toBe("/traces/trace_1");
      expect(
        await repositories.resourceLinks.resolve({
          conversationId: turn.conversationId,
          id: "link_2",
        }),
      ).toBeNull();
    });
  });

  describe("when a folder is shared with a conversation", () => {
    it("reads back the connection that was registered", async () => {
      const repositories = create();

      await repositories.localPresence.register(workspaceFor("instance_1"));

      expect(await repositories.localPresence.read(turn.conversationId)).toEqual(
        workspaceFor("instance_1"),
      );
    });

    it("reads back the permission-card choice the developer wrote", async () => {
      const repositories = create();

      expect(await repositories.localPresence.readPolicy(turn.conversationId)).toBe(false);

      await repositories.localPresence.writePolicy({
        conversationId: turn.conversationId,
        skipPermissions: true,
      });

      expect(await repositories.localPresence.readPolicy(turn.conversationId)).toBe(true);
    });
  });

  describe("when a status is put on the live edge", () => {
    it("replays it from the tail of the turn's stream", async () => {
      const repositories = create();
      const buffer = repositories.tokenBuffer.open({ redis: undefined });

      await buffer.appendStatus({ ...turn, status: "reading the trace" });

      const tail = await buffer.readTail(turn);

      expect(tail.reads.map((read) => read.entry)).toEqual([
        { type: "status", status: "reading the trace" },
      ]);
      expect(tail.lastId).not.toBe("0-0");
    });
  });

  describe("when the token buffer is opened twice for the same store", () => {
    it("both openings read back the same turn's entries", async () => {
      const repositories = create();
      const first = repositories.tokenBuffer.open({ redis: undefined });
      const second = repositories.tokenBuffer.open({ redis: undefined });

      await first.appendStatus({ ...turn, status: "reading the trace" });

      expect((await second.readTail(turn)).reads.map((read) => read.entry)).toEqual([
        { type: "status", status: "reading the trace" },
      ]);
    });
  });

  describe("when two rows are written for the same turn", () => {
    it("answers from the one store the set shares, and never from another set's", async () => {
      const repositories = create();
      const other = create();

      await repositories.turnAccess.grant(accessFor("user_1"));
      await repositories.turnHandoff.stash(handoffFor("user_1"));

      expect(await repositories.turnAccess.isTurnActor(accessFor("user_1"))).toBe(true);
      expect(await repositories.turnHandoff.read(turn)).toEqual(handoffFor("user_1"));

      expect(await other.turnAccess.isTurnActor(accessFor("user_1"))).toBe(false);
      expect(await other.turnHandoff.read(turn)).toBeNull();
    });
  });
});

describe("given the langy repository registry", () => {
  describe("when the memory tier is selected", () => {
    it("needs no members and hands back every row", () => {
      expect(langyRepositories.definitions.memory.requires).toEqual([]);

      const repositories = instantiateRepositories(langyRepositories, {
        backend: "memory",
        members: {},
      });

      expect(Object.keys(repositories).sort()).toEqual([
        "frameDedup",
        "localPresence",
        "resourceLinks",
        "tokenBuffer",
        "turnAccess",
        "turnHandoff",
      ]);
    });
  });
});
