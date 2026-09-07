/**
 * The local call state machine over the in-memory store, with a stand-in for
 * the command line: it takes the nudge off the channel the gateway subscribes
 * to and writes the answers back the way a socket's pod does.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import { LocalCallDispatcher, type WorkspaceNudge } from "../call.dispatcher";
import { workspaceChannel } from "../keys";
import { LocalWorkspacePresence } from "../presence";

const projectId = "proj_1";
const conversationId = "conv_1";
const turnId = "turn_1";

let now = 1_700_000_000_000;
let store: AgentStateStore;
let presence: LocalWorkspacePresence;
let dispatcher: LocalCallDispatcher;

function workspace() {
  return {
    conversationId,
    projectId,
    userId: "user_1",
    requestId: "lcr_1",
    instanceId: "lci_1",
    hostname: "rogerio-mbp",
    connectedAt: now,
    lastSeenAt: now,
    workspace: {
      root: "/Users/dev/acme-app",
      name: "acme-app",
      os: "darwin",
    },
  };
}

function listCall() {
  return { tool: "local_ls", params: { path: "." } } as const;
}

/** Every nudge published on the conversation's channel, in order. */
async function collectNudges(): Promise<WorkspaceNudge[]> {
  const seen: WorkspaceNudge[] = [];
  await store.subscribe(workspaceChannel(conversationId), (raw) => {
    seen.push(JSON.parse(raw) as WorkspaceNudge);
  });
  return seen;
}

beforeEach(() => {
  now = 1_700_000_000_000;
  store = createMemoryStateStore({ now: () => now });
  presence = new LocalWorkspacePresence({ store, now: () => now });
  dispatcher = new LocalCallDispatcher({
    store,
    presence,
    now: () => now,
    offlineWaitMs: 0,
    pollIntervalMs: 1,
  });
});

describe("given a folder connected to the conversation", () => {
  beforeEach(async () => {
    await presence.register(workspace());
  });

  describe("when Langy places a call", () => {
    /** @scenario "A local call travels to the CLI and its result comes back" */
    it("nudges the folder's channel and answers with the result", async () => {
      const nudges = await collectNudges();

      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: listCall(),
        timeoutMs: 60_000,
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(nudges).toContainEqual({ call: call.callId });

      await dispatcher.ack(call.callId);
      expect((await dispatcher.read(call.callId))?.state).toBe("running");

      await dispatcher.result({
        callId: call.callId,
        frame: { ok: true, text: "README.md\npackage.json" },
      });

      const answer = await dispatcher.poll({ callId: call.callId, holdMs: 0 });
      expect(answer).toMatchObject({
        state: "done",
        ok: true,
        text: "README.md\npackage.json",
      });
    });

    /** @scenario "A call and its socket can be on different pods" */
    it("is delivered from the store, so another replica can serve the socket", async () => {
      const otherPod = new LocalCallDispatcher({
        store,
        presence: new LocalWorkspacePresence({ store, now: () => now }),
        now: () => now,
        offlineWaitMs: 0,
        pollIntervalMs: 1,
      });

      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: listCall(),
        timeoutMs: 60_000,
      });

      const envelopes = await otherPod.pendingEnvelopes(conversationId);
      expect(envelopes.map((envelope) => envelope.callId)).toEqual([
        call.callId,
      ]);
      await otherPod.result({
        callId: call.callId,
        frame: { ok: true, text: "listed" },
      });
      expect(
        await dispatcher.poll({ callId: call.callId, holdMs: 0 }),
      ).toMatchObject({ state: "done", text: "listed" });
    });
  });

  describe("when the command line asks for the developer's permission", () => {
    it("holds the call in awaiting_permission until the answer arrives", async () => {
      const nudges = await collectNudges();
      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm typecheck" } },
        timeoutMs: 60_000,
      });
      await dispatcher.ack(call.callId);

      await dispatcher.awaitPermission({
        callId: call.callId,
        waitId: "lwait_1",
      });
      expect((await dispatcher.read(call.callId))?.state).toBe(
        "awaiting_permission",
      );

      await dispatcher.sendPermission({
        conversationId,
        callId: call.callId,
        decision: "allow_once",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect((await dispatcher.read(call.callId))?.state).toBe("running");
      expect(nudges).toContainEqual({
        permission: { callId: call.callId, decision: "allow_once" },
      });
    });
  });

  describe("when the turn is stopped", () => {
    /** @scenario "Stopping the turn cancels the command on the machine" */
    it("tells the folder to cancel and settles the call as cancelled", async () => {
      const nudges = await collectNudges();
      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm build" } },
        timeoutMs: 60_000,
      });

      await dispatcher.cancel({ callId: call.callId });
      await new Promise((resolve) => setImmediate(resolve));

      expect(nudges).toContainEqual({ cancel: call.callId });
      expect(
        await dispatcher.poll({ callId: call.callId, holdMs: 0 }),
      ).toMatchObject({
        state: "done",
        ok: false,
        error: { code: "cancelled" },
      });
    });

    it("cancels a second time without contradicting the first answer", async () => {
      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: listCall(),
        timeoutMs: 60_000,
      });
      await dispatcher.result({
        callId: call.callId,
        frame: { ok: true, text: "listed" },
      });

      expect(await dispatcher.cancel({ callId: call.callId })).toBeNull();
      expect(
        await dispatcher.poll({ callId: call.callId, holdMs: 0 }),
      ).toMatchObject({ ok: true, text: "listed" });
    });
  });

  describe("when the folder disconnects with a call in flight", () => {
    it("lists the call so the disconnect path can fail it at once", async () => {
      const call = await dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: listCall(),
        timeoutMs: 60_000,
      });

      expect(
        (await dispatcher.listPendingForTurn({ conversationId, turnId })).map(
          (row) => row.callId,
        ),
      ).toEqual([call.callId]);
      expect(
        await dispatcher.listPendingForTurn({
          conversationId,
          turnId: "turn_2",
        }),
      ).toEqual([]);
    });
  });
});

describe("given no folder connected to the conversation", () => {
  describe("when Langy places a call", () => {
    /** @scenario "A local call without a folder gets a pushback, not an error" */
    it("refuses with the offline code and names the sharing step", async () => {
      await expect(
        dispatcher.start({
          projectId,
          conversationId,
          turnId,
          call: listCall(),
          timeoutMs: 60_000,
        }),
      ).rejects.toMatchObject({
        code: "langy_local_workspace_offline",
      });
    });
  });
});

describe("given a folder whose machine went to sleep", () => {
  describe("when the presence window passes with no heartbeat", () => {
    /** @scenario "A folder not seen for thirty seconds reads offline" */
    it("reads offline, and the next call gets the offline pushback", async () => {
      await presence.register(workspace());
      now += 31_000;

      expect(await presence.read(conversationId)).toBeNull();
      await expect(
        dispatcher.start({
          projectId,
          conversationId,
          turnId,
          call: listCall(),
          timeoutMs: 60_000,
        }),
      ).rejects.toMatchObject({ code: "langy_local_workspace_offline" });
    });
  });
});
