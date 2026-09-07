/**
 * What one heartbeat does to the folder record: it moves it on, it writes it
 * back after the record lapsed under an open connection, and it keeps its
 * hands off a conversation a newer connection took over.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import { presenceKey } from "../keys";
import { type ConnectedWorkspace, LocalWorkspacePresence } from "../presence";

const conversationId = "conv_1";

let now = 1_700_000_000_000;
let store: AgentStateStore;
let presence: LocalWorkspacePresence;

function workspace(instanceId = "lci_1"): ConnectedWorkspace {
  return {
    conversationId,
    projectId: "proj_1",
    userId: "user_1",
    requestId: "lcr_1",
    instanceId,
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

beforeEach(() => {
  now = 1_700_000_000_000;
  store = createMemoryStateStore({ now: () => now });
  presence = new LocalWorkspacePresence({ store, now: () => now });
});

describe("given a folder connected to the conversation", () => {
  describe("when its connection beats", () => {
    it("moves the record on", async () => {
      await presence.register(workspace());
      now += 10_000;

      expect(await presence.heartbeat(workspace())).toBe("refreshed");
      expect((await presence.read(conversationId))?.lastSeenAt).toBe(now);
    });
  });

  describe("when the record lapsed while the connection stayed open", () => {
    /** @scenario "A pause on the platform does not disconnect a live folder" */
    it("writes the folder back on the next beat", async () => {
      await presence.register(workspace());
      // The pod that holds the connection stopped for longer than the record
      // lives, so every clock it owns missed its turn and the key went.
      await store.del(presenceKey(conversationId));
      now += 31_000;

      expect(await presence.read(conversationId)).toBeNull();
      expect(await presence.heartbeat(workspace())).toBe("restored");

      const restored = await presence.read(conversationId);
      expect(restored?.instanceId).toBe("lci_1");
      expect(restored?.workspace.root).toBe("/Users/dev/acme-app");
      expect(restored?.lastSeenAt).toBe(now);
    });
  });

  describe("when a newer connection took the conversation over", () => {
    it("leaves the newer folder alone", async () => {
      await presence.register(workspace("lci_2"));
      now += 1_000;

      expect(await presence.heartbeat(workspace("lci_1"))).toBe("replaced");
      expect((await presence.read(conversationId))?.instanceId).toBe("lci_2");
    });
  });
});
