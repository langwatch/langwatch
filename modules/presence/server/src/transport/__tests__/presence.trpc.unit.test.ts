/**
 * The `presence.*` tRPC wire, pinned: every procedure name, its kind, the
 * permission the server binds to it, and the identity a write is recorded
 * under.
 * @see modules/presence/specs/presence.feature
 * @see specs/presence/multiplayer-presence.feature
 */
import {
  presenceTrpc,
  type PresenceCursorEvent,
  type PresenceEvent,
  type PresenceLocation,
} from "@langwatch/presence-contract";
import { describe, expect, it } from "vitest";

import {
  createPresenceTestApp,
  createPresenceTestProjects,
  createPresenceTestUsers,
  RecordingPresenceBroadcast,
  TestPresenceEmitters,
} from "../../app/__tests__/presence.fixture.ts";
import { presenceTrpcTransport } from "../presence.trpc.ts";
import { accessDeclaredBy, presenceTrpcCaller } from "./presence-trpc.fixture.ts";

const location: PresenceLocation = { lens: "traces", route: { traceId: "trace-1" } };

function createCaller(options: { enabled?: boolean; permitted?: boolean; userId?: string } = {}) {
  const broadcast = new RecordingPresenceBroadcast();
  const emitters = new TestPresenceEmitters();
  const app = createPresenceTestApp({
    broadcast,
    emitters,
    projects: createPresenceTestProjects(options.enabled ?? true),
    users: createPresenceTestUsers({ name: "Ada", image: "https://example.test/ada.png" }),
  });
  const mounted = presenceTrpcCaller({
    declaration: presenceTrpcTransport,
    app,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
    ...(options.permitted === undefined ? {} : { permitted: options.permitted }),
  });

  return { ...mounted, app, broadcast, emitters };
}

/** Every `presence_updated` delta the fan-out was handed, decoded. */
function deltas(broadcast: RecordingPresenceBroadcast): PresenceEvent[] {
  return broadcast.publish.mock.calls
    .map(([input]) => input)
    .filter((input) => input.channel === "presence_updated")
    .map((input) => JSON.parse(input.event) as PresenceEvent);
}

describe("given the presence declaration", () => {
  /** @scenario "Existing transports remain compatible" */
  it("declares exactly the presence procedure names the client calls", () => {
    expect(Object.keys(presenceTrpc.members).sort()).toEqual([
      "cursor",
      "leave",
      "onPresenceCursor",
      "onPresenceUpdate",
      "update",
    ]);
  });

  it("binds every declared procedure once, under the permission seeing traces takes", () => {
    expect(
      Object.entries(presenceTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        accessDeclaredBy(presenceTrpcTransport)[index],
      ]),
    ).toEqual([
      ["update", "mutation", "traces:view"],
      ["leave", "mutation", "traces:view"],
      ["cursor", "mutation", "traces:view"],
      ["onPresenceUpdate", "subscription", "traces:view"],
      ["onPresenceCursor", "subscription", "traces:view"],
    ]);
  });
});

describe("when a browser session sends a heartbeat", () => {
  /** @scenario "A user cannot impersonate another user's presence session" */
  it("records the session under the authenticated identity, never the payload's", async () => {
    const { caller, broadcast, app } = createCaller({ userId: "user-bob" });

    await expect(
      caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
    ).resolves.toEqual({ ok: true });

    expect(deltas(broadcast)[0]).toMatchObject({
      kind: "join",
      session: {
        user: { id: "user-bob", name: "Ada", image: "https://example.test/ada.png" },
      },
    });
    await expect(app.list({ projectId: "project-1" })).resolves.toMatchObject([
      { sessionId: "tab-1", user: { id: "user-bob" } },
    ]);
  });

  it("has no place on the wire for a claimed identity", () => {
    expect(
      presenceTrpc.members.update.input.safeParse({
        projectId: "project-1",
        sessionId: "tab-1",
        location,
        user: { id: "user-alice", name: "Alice", image: null },
      }).success,
    ).toBe(false);
  });

  it("records nothing when presence is switched off for the project", async () => {
    const { caller, app } = createCaller({ enabled: false });

    await expect(
      caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
    ).resolves.toEqual({ ok: true });
    await expect(app.list({ projectId: "project-1" })).resolves.toEqual([]);
  });

  it("refuses the heartbeat when the caller cannot view the project", async () => {
    const { caller, app } = createCaller({ permitted: false });

    await expect(
      caller.update({ projectId: "project-1", sessionId: "tab-1", location }),
    ).rejects.toThrow();
    await expect(app.list({ projectId: "project-1" })).resolves.toEqual([]);
  });
});

describe("when a browser session leaves", () => {
  it("removes the session it published and tells peers", async () => {
    const { caller, broadcast } = createCaller();
    await caller.update({ projectId: "project-1", sessionId: "tab-1", location });

    await expect(caller.leave({ projectId: "project-1", sessionId: "tab-1" })).resolves.toEqual({
      ok: true,
    });
    expect(deltas(broadcast).at(-1)).toEqual({ kind: "leave", sessionId: "tab-1" });
  });

  it("refuses to remove a session another member published", async () => {
    const { caller, app } = createCaller({ userId: "user-alice" });
    await caller.update({ projectId: "project-1", sessionId: "tab-1", location });

    const bob = presenceTrpcCaller({
      declaration: presenceTrpcTransport,
      app,
      userId: "user-bob",
    }).caller;

    await expect(bob.leave({ projectId: "project-1", sessionId: "tab-1" })).rejects.toMatchObject({
      message: expect.stringContaining("someone else"),
    });
    await expect(app.list({ projectId: "project-1" })).resolves.toHaveLength(1);
  });
});

describe("when a cursor tick arrives", () => {
  it("broadcasts it under the authenticated identity, never the payload's", async () => {
    const { caller, broadcast } = createCaller({ userId: "user-bob" });

    await expect(
      caller.cursor({
        projectId: "project-1",
        sessionId: "tab-1",
        payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
      }),
    ).resolves.toEqual({ ok: true });

    const tick = broadcast.publish.mock.calls
      .map(([input]) => input)
      .find((input) => input.channel === "presence_cursor");
    expect(tick).toMatchObject({ rateLimited: true });
    expect(JSON.parse(tick!.event) as PresenceCursorEvent).toMatchObject({
      sessionId: "tab-1",
      user: { id: "user-bob", name: "Ada" },
      anchor: "trace:trace-1",
      x: 0.5,
      y: 0.5,
    });
  });

  it("broadcasts nothing when presence is switched off for the project", async () => {
    const { caller, broadcast } = createCaller({ enabled: false });

    await expect(
      caller.cursor({
        projectId: "project-1",
        sessionId: "tab-1",
        payload: { anchor: "trace:trace-1", x: 0.5, y: 0.5 },
      }),
    ).resolves.toEqual({ ok: true });
    expect(broadcast.publish).not.toHaveBeenCalled();
  });
});

describe("when a client subscribes to presence updates", () => {
  it("opens with a snapshot of the sessions the project already has", async () => {
    const { caller } = createCaller();
    await caller.update({ projectId: "project-1", sessionId: "tab-1", location });

    const received: PresenceEvent[] = [];
    const stream = await caller.onPresenceUpdate({ projectId: "project-1" });
    for await (const event of stream) {
      received.push(event);
      break;
    }

    expect(received).toMatchObject([{ kind: "snapshot", sessions: [{ sessionId: "tab-1" }] }]);
  });

  it("answers an empty snapshot while presence is switched off", async () => {
    const { caller } = createCaller({ enabled: false });

    const received: PresenceEvent[] = [];
    for await (const event of await caller.onPresenceUpdate({ projectId: "project-1" })) {
      received.push(event);
    }

    expect(received).toEqual([{ kind: "snapshot", sessions: [] }]);
  });

  /** @scenario "A user without traces:view permission for the project cannot subscribe" */
  it("never reaches the broadcast fabric when the caller cannot view the project", async () => {
    const { caller, emitters } = createCaller({ permitted: false });

    await expect(async () => {
      for await (const _event of await caller.onPresenceUpdate({ projectId: "project-1" })) {
        // consuming the stream is what surfaces the refusal
      }
    }).rejects.toThrow();
    expect(emitters.getTenantEmitter).not.toHaveBeenCalled();
  });
});

describe("when a client subscribes to cursor ticks", () => {
  it("yields nothing while presence is switched off", async () => {
    const { caller } = createCaller({ enabled: false });

    const received: PresenceCursorEvent[] = [];
    for await (const event of await caller.onPresenceCursor({
      projectId: "project-1",
      anchor: "trace:trace-1",
      sessionId: "tab-1",
    })) {
      received.push(event);
    }

    expect(received).toEqual([]);
  });
});
