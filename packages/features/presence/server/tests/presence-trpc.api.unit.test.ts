import { EventEmitter } from "node:events";
import {
  PresenceService,
  type PresenceCursorEvent,
  type PresenceEvent,
  type PresenceLocation,
  type PresenceSession,
} from "@langwatch/presence-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { TrpcRootDefinition } from "@langwatch/trpc";
import { describe, expect, it, vi } from "vitest";
import { PresenceTrpcApi, type PresenceTrpcContext } from "../src/api/app-trpc/presence.api";
import { PresenceBroadcastPort, PresenceEmitterPort } from "../src/ports/presence.port";
import { PresenceRepository } from "../src/repositories/presence.repository";
import { PresenceService as ComposedPresenceService } from "../src/services/presence.service";

const location: PresenceLocation = { lens: "traces", route: { traceId: "trace-1" } };

const session: PresenceSession = {
  projectId: "project-1",
  sessionId: "tab-1",
  user: { id: "user-1", name: "Ada", image: "https://example.test/ada.png" },
  location,
  updatedAt: 1,
};

class TestPresenceService extends PresenceService {
  enabled = true;
  readonly isEnabledForProject = vi.fn(async () => this.enabled);
  readonly update = vi.fn(async () => session);
  readonly leave = vi.fn(async () => undefined);
  readonly list = vi.fn(async () => [session]);
  readonly broadcastCursor = vi.fn(async () => undefined);
}

class TestEmitters extends PresenceEmitterPort {
  readonly emitter = new EventEmitter();
  readonly getTenantEmitter = vi.fn(() => this.emitter);
  readonly cleanupTenantEmitter = vi.fn();
}

function createCaller(presence: TestPresenceService) {
  const authorize = vi.fn(async () => undefined);
  const actor = vi.fn(() => ({ id: "user-1" }));
  const emitters = new TestEmitters();
  const context: PresenceTrpcContext = {
    app: { presence, broadcast: emitters },
    actor,
    session: { user: { id: "user-1", name: "Ada", image: "https://example.test/ada.png" } },
    authorize,
  };

  const root = TrpcRootDefinition.forContext<PresenceTrpcContext>().create({});
  const router = PresenceTrpcApi.create(root);

  return { authorize, actor, emitters, caller: router.createCaller(context), router };
}

describe("PresenceTrpcApi", () => {
  describe("given the composed router", () => {
    it("exposes exactly the presence procedure names the client calls", () => {
      const { router } = createCaller(new TestPresenceService());
      const procedures = (router as unknown as { _def: { procedures: Record<string, unknown> } })
        ._def.procedures;

      expect(Object.keys(procedures).sort()).toEqual([
        "cursor",
        "leave",
        "onPresenceCursor",
        "onPresenceUpdate",
        "update",
      ]);
    });
  });

  describe("when a browser session sends a heartbeat", () => {
    /** @scenario "A user cannot impersonate another user's presence session" */
    it("checks traces:view and records the session under the authenticated identity", async () => {
      const presence = new TestPresenceService();
      const { authorize, caller } = createCaller(presence);

      await expect(
        caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
      ).resolves.toEqual({ ok: true });

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(presence.update).toHaveBeenCalledWith({
        projectId: "project-1",
        sessionId: "tab-1",
        user: { id: "user-1", name: "Ada", image: "https://example.test/ada.png" },
        location,
      });
    });

    it("records nothing when presence is switched off for the project", async () => {
      const presence = new TestPresenceService();
      presence.enabled = false;
      const { authorize, caller } = createCaller(presence);

      await expect(
        caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
      ).resolves.toEqual({ ok: true });

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(presence.update).not.toHaveBeenCalled();
    });

    it("refuses the heartbeat when the caller cannot view the project", async () => {
      const presence = new TestPresenceService();
      const { authorize, caller } = createCaller(presence);
      authorize.mockRejectedValueOnce(new Error("denied"));

      await expect(
        caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
      ).rejects.toThrow("denied");
      expect(presence.update).not.toHaveBeenCalled();
    });
  });

  describe("when a browser session leaves", () => {
    it("checks traces:view and removes the session", async () => {
      const presence = new TestPresenceService();
      const { authorize, caller } = createCaller(presence);

      await expect(caller.leave({ projectId: "project-1", sessionId: "tab-1" })).resolves.toEqual({
        ok: true,
      });

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(presence.leave).toHaveBeenCalledWith({
        projectId: "project-1",
        sessionId: "tab-1",
      });
    });

    it("removes nothing when presence is switched off for the project", async () => {
      const presence = new TestPresenceService();
      presence.enabled = false;
      const { caller } = createCaller(presence);

      await expect(caller.leave({ projectId: "project-1", sessionId: "tab-1" })).resolves.toEqual({
        ok: true,
      });
      expect(presence.leave).not.toHaveBeenCalled();
    });
  });

  describe("when a cursor tick arrives", () => {
    it("broadcasts it under the authenticated identity, never the payload's", async () => {
      const presence = new TestPresenceService();
      const { authorize, caller } = createCaller(presence);

      await expect(
        caller.cursor({
          projectId: "project-1",
          sessionId: "tab-1",
          payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
        }),
      ).resolves.toEqual({ ok: true });

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(presence.broadcastCursor).toHaveBeenCalledWith({
        projectId: "project-1",
        sessionId: "tab-1",
        user: { id: "user-1", name: "Ada", image: "https://example.test/ada.png" },
        payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
      });
    });

    it("broadcasts nothing when presence is switched off for the project", async () => {
      const presence = new TestPresenceService();
      presence.enabled = false;
      const { caller } = createCaller(presence);

      await expect(
        caller.cursor({
          projectId: "project-1",
          sessionId: "tab-1",
          payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
        }),
      ).resolves.toEqual({ ok: true });
      expect(presence.broadcastCursor).not.toHaveBeenCalled();
    });
  });

  describe("when a client subscribes to presence updates", () => {
    it("checks traces:view before opening the stream", async () => {
      const presence = new TestPresenceService();
      presence.enabled = false;
      const { authorize, caller } = createCaller(presence);

      const received: PresenceEvent[] = [];
      for await (const event of await caller.onPresenceUpdate({ projectId: "project-1" })) {
        received.push(event);
      }

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(received).toEqual([{ kind: "snapshot", sessions: [] }]);
    });

    /** @scenario "A user without traces:view permission for the project cannot subscribe" */
    it("never reaches the broadcast fabric when the caller cannot view the project", async () => {
      const presence = new TestPresenceService();
      const { authorize, emitters, caller } = createCaller(presence);
      authorize.mockRejectedValueOnce(new Error("denied"));

      await expect(async () => {
        for await (const _event of await caller.onPresenceUpdate({ projectId: "project-1" })) {
          // consuming the stream is what surfaces the refusal
        }
      }).rejects.toThrow("denied");
      expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
    });
  });

  describe("when a client subscribes to cursor ticks", () => {
    it("checks traces:view and yields nothing while presence is switched off", async () => {
      const presence = new TestPresenceService();
      presence.enabled = false;
      const { authorize, caller } = createCaller(presence);

      const received: PresenceCursorEvent[] = [];
      for await (const event of await caller.onPresenceCursor({
        projectId: "project-1",
        anchor: "trace:trace-1",
        sessionId: "tab-1",
      })) {
        received.push(event);
      }

      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
      expect(received).toEqual([]);
    });
  });

  describe("given the composed presence service rather than a stub", () => {
    class StubRepository extends PresenceRepository {
      readonly upsert = vi.fn(async () => undefined);
      readonly remove = vi.fn(async () => true);
      readonly listByProject = vi.fn(async () => [] as PresenceSession[]);
      readonly tryFindSession = vi.fn(async () => null);
    }

    class StubBroadcast extends PresenceBroadcastPort {
      readonly publish = vi.fn(async () => undefined);
    }

    function createComposedCaller() {
      const repository = new StubRepository();
      const projects = { isPresenceEnabled: async () => true } as unknown as ProjectService;
      const presence = ComposedPresenceService.create({
        repository,
        broadcast: new StubBroadcast(),
        projects,
        now: () => 42,
      });
      const context: PresenceTrpcContext = {
        app: { presence, broadcast: new TestEmitters() },
        actor: () => ({ id: "user-1" }),
        session: { user: { id: "user-1", name: "Ada", image: null } },
        authorize: async () => undefined,
      };
      const root = TrpcRootDefinition.forContext<PresenceTrpcContext>().create({});
      return { repository, caller: PresenceTrpcApi.create(root).createCaller(context) };
    }

    /**
     * The policy lookup takes a strict project input. Handing it the whole
     * mutation payload made every heartbeat, leave and cursor tick reject with
     * an unrecognised-keys error before any presence work happened, which the
     * client only ever saw as an unknown failure.
     */
    it("asks the policy for the project alone, so a heartbeat reaches the repository", async () => {
      const { repository, caller } = createComposedCaller();

      await expect(
        caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
      ).resolves.toEqual({ ok: true });
      expect(repository.upsert).toHaveBeenCalledTimes(1);
    });

    it("asks the policy for the project alone, so a leave reaches the repository", async () => {
      const { repository, caller } = createComposedCaller();

      await expect(caller.leave({ projectId: "project-1", sessionId: "tab-1" })).resolves.toEqual({
        ok: true,
      });
      expect(repository.remove).toHaveBeenCalledWith("project-1", "tab-1");
    });

    it("asks the policy for the project alone, so a cursor tick is broadcast", async () => {
      const { caller } = createComposedCaller();

      await expect(
        caller.cursor({
          projectId: "project-1",
          sessionId: "tab-1",
          payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
        }),
      ).resolves.toEqual({ ok: true });
    });
  });
});
