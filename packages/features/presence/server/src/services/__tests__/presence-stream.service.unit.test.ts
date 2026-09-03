import { EventEmitter } from "node:events";
import type {
  PresenceCursorEvent,
  PresenceEvent,
  PresenceSession,
} from "@langwatch/presence-contract";
import { describe, expect, it, vi } from "vitest";
import { PresenceEmitterPort } from "../../ports/presence.port";
import { PresenceStreamService } from "../presence-stream.service";

const session: PresenceSession = {
  projectId: "project-1",
  sessionId: "tab-1",
  user: { id: "user-1", name: "Ada", image: null },
  location: { lens: "traces", route: { traceId: "trace-1" } },
  updatedAt: 1,
};

const cursor: PresenceCursorEvent = {
  projectId: "project-1",
  sessionId: "tab-2",
  user: { id: "user-2", name: "Grace", image: null },
  anchor: "trace:trace-1",
  x: 0.5,
  y: 0.25,
  emittedAt: 2,
};

class RecordingEmitters extends PresenceEmitterPort {
  readonly emitter = new EventEmitter();
  cleaned: string[] = [];

  getTenantEmitter = vi.fn((_tenantId: string) => this.emitter);
  cleanupTenantEmitter = vi.fn((tenantId: string) => {
    this.cleaned.push(tenantId);
  });
}

function createPresence(options: { enabled: boolean; sessions?: PresenceSession[] }) {
  return {
    enabled: options.enabled,
    isEnabledForProject: vi.fn(async () => options.enabled),
    list: vi.fn(async () => options.sessions ?? []),
    update: vi.fn(),
    leave: vi.fn(),
    broadcastCursor: vi.fn(),
  } as unknown as Parameters<typeof PresenceStreamService.create>[0]["presence"];
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs the stream to completion around a burst of broadcast frames. */
async function drain<T>({
  stream,
  controller,
  emit,
}: {
  stream: AsyncGenerator<T>;
  controller: AbortController;
  emit: () => void;
}): Promise<T[]> {
  const received: T[] = [];
  const pump = (async () => {
    try {
      for await (const event of stream) received.push(event);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") throw error;
    }
  })();

  await tick();
  await tick();
  emit();
  await tick();
  controller.abort();
  await pump;
  return received;
}

function frame(payload: unknown) {
  return { event: typeof payload === "string" ? payload : JSON.stringify(payload), timestamp: 1 };
}

describe("PresenceStreamService", () => {
  describe("given presence is disabled for the project", () => {
    it("yields one empty snapshot and completes", async () => {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: false }),
        emitters,
      });

      const received: PresenceEvent[] = [];
      for await (const event of stream.events({ projectId: "project-1" })) received.push(event);

      expect(received).toEqual([{ kind: "snapshot", sessions: [] }]);
      expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
    });

    it("yields no cursor at all", async () => {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: false }),
        emitters,
      });

      const received: PresenceCursorEvent[] = [];
      for await (const event of stream.cursors({
        projectId: "project-1",
        anchor: "trace:trace-1",
        sessionId: "tab-1",
      })) {
        received.push(event);
      }

      expect(received).toEqual([]);
      expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
    });
  });

  describe("when a subscriber connects to an enabled project", () => {
    /** @scenario "Subscribers receive a snapshot of currently active sessions on connect" */
    it("opens with a snapshot of the sessions currently present", async () => {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: true, sessions: [session] }),
        emitters,
      });
      const controller = new AbortController();

      const received = await drain({
        stream: stream.events({ projectId: "project-1", signal: controller.signal }),
        controller,
        emit: () => undefined,
      });

      expect(received).toEqual([{ kind: "snapshot", sessions: [session] }]);
    });

    it("releases the tenant emitter when the subscriber disconnects", async () => {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: true }),
        emitters,
      });
      const controller = new AbortController();

      await drain({
        stream: stream.events({ projectId: "project-1", signal: controller.signal }),
        controller,
        emit: () => undefined,
      });

      expect(emitters.cleaned).toEqual(["project-1"]);
    });
  });

  describe("when the tenant emitter carries presence frames", () => {
    async function eventsAround(emit: (emitter: EventEmitter) => void) {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: true }),
        emitters,
      });
      const controller = new AbortController();

      const received = await drain({
        stream: stream.events({ projectId: "project-1", signal: controller.signal }),
        controller,
        emit: () => emit(emitters.emitter),
      });

      return received.slice(1);
    }

    /** @scenario "Joining a project announces the new session to subscribers" */
    it("relays a join delta for the subscribed project", async () => {
      const deltas = await eventsAround((emitter) => {
        emitter.emit("presence_updated", frame({ kind: "join", session }));
      });

      expect(deltas).toEqual([{ kind: "join", session }]);
    });

    it("drops a frame whose payload is not JSON", async () => {
      const deltas = await eventsAround((emitter) => {
        emitter.emit("presence_updated", frame("not-json"));
      });

      expect(deltas).toEqual([]);
    });

    it("drops a frame that is not a presence event", async () => {
      const deltas = await eventsAround((emitter) => {
        emitter.emit("presence_updated", frame({ kind: "nonsense" }));
      });

      expect(deltas).toEqual([]);
    });

    /** @scenario "Presence is scoped to a single project" */
    it("refuses to relay a session belonging to another project", async () => {
      const deltas = await eventsAround((emitter) => {
        emitter.emit(
          "presence_updated",
          frame({ kind: "join", session: { ...session, projectId: "project-2" } }),
        );
      });

      expect(deltas).toEqual([]);
    });
  });

  describe("when the tenant emitter carries cursor frames", () => {
    async function cursorsAround(emit: (emitter: EventEmitter) => void) {
      const emitters = new RecordingEmitters();
      const stream = PresenceStreamService.create({
        presence: createPresence({ enabled: true }),
        emitters,
      });
      const controller = new AbortController();

      return drain({
        stream: stream.cursors({
          projectId: "project-1",
          anchor: "trace:trace-1",
          sessionId: "tab-1",
          signal: controller.signal,
        }),
        controller,
        emit: () => emit(emitters.emitter),
      });
    }

    it("relays a peer cursor on the watched anchor", async () => {
      const received = await cursorsAround((emitter) => {
        emitter.emit("presence_cursor", frame(cursor));
      });

      expect(received).toEqual([cursor]);
    });

    it("drops a cursor on a different anchor", async () => {
      const received = await cursorsAround((emitter) => {
        emitter.emit("presence_cursor", frame({ ...cursor, anchor: "trace:other" }));
      });

      expect(received).toEqual([]);
    });

    it("does not echo the subscriber's own cursor back", async () => {
      const received = await cursorsAround((emitter) => {
        emitter.emit("presence_cursor", frame({ ...cursor, sessionId: "tab-1" }));
      });

      expect(received).toEqual([]);
    });

    it("drops a cursor belonging to another project", async () => {
      const received = await cursorsAround((emitter) => {
        emitter.emit("presence_cursor", frame({ ...cursor, projectId: "project-2" }));
      });

      expect(received).toEqual([]);
    });

    it("drops a frame whose payload is not JSON", async () => {
      const received = await cursorsAround((emitter) => {
        emitter.emit("presence_cursor", frame("not-json"));
      });

      expect(received).toEqual([]);
    });
  });
});
