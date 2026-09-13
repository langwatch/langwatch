/**
 * @vitest-environment node
 *
 * A call that waits on a permission card outlives the card, not the command.
 *
 * The envelope used to live for the command's own time limit plus a minute,
 * while the card was allowed ten minutes. A thirty second command whose ask
 * stayed open ninety seconds lost its envelope, the worker's poll answered
 * "not found" three times, and the model was told the shared folder had gone
 * away while the command line was still connected.
 *
 * @see specs/langy/langy-local-control.feature
 */

import { describe, expect, it } from "vitest";
import {
  type AgentStateStore,
  createMemoryStateStore,
} from "~/server/connected-agents/state-store";
import { LocalCallDispatcher } from "../call.dispatcher";
import { LocalWorkspacePresence } from "../presence";

const projectId = "project_envelope";
const conversationId = "conv_envelope";
const turnId = "turn_envelope";

/** The command's own limit, and how long the developer took to answer. */
const COMMAND_TIMEOUT_MS = 30_000;
const ANSWER_DELAY_MS = 120_000;

function connectedFolder(now: number) {
  return {
    conversationId,
    projectId,
    userId: "user_1",
    requestId: "lcr_1",
    instanceId: "lci_1",
    hostname: "rogerio-mbp",
    connectedAt: now,
    lastSeenAt: now,
    workspace: { root: "/Users/dev/acme-app", name: "acme-app", os: "darwin" },
  };
}

async function callWaitingOnACard(clock: { now: number }) {
  const store: AgentStateStore = createMemoryStateStore({
    now: () => clock.now,
  });
  const presence = new LocalWorkspacePresence({ store, now: () => clock.now });
  await presence.register(connectedFolder(clock.now));
  const dispatcher = new LocalCallDispatcher({
    store,
    presence,
    now: () => clock.now,
    offlineWaitMs: 0,
    pollIntervalMs: 1,
  });
  const call = await dispatcher.start({
    projectId,
    conversationId,
    turnId,
    call: {
      tool: "local_bash",
      params: { command: "git push -u origin HEAD", timeout: 30 },
    },
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  await dispatcher.ack(call.callId);
  await dispatcher.awaitPermission({ callId: call.callId, waitId: "lwait_1" });
  return { dispatcher, store, callId: call.callId };
}

describe("given a call waiting on a permission card", () => {
  describe("when the developer answers long after the command's own limit", () => {
    /** @scenario "A call waiting on a permission card keeps its envelope" */
    it("still holds the call, and gives the command its whole limit again", async () => {
      const clock = { now: 1_752_600_100_000 };
      const { dispatcher, callId } = await callWaitingOnACard(clock);

      clock.now += ANSWER_DELAY_MS;

      const waiting = await dispatcher.read(callId);
      expect(waiting?.state).toBe("awaiting_permission");
      const polled = await dispatcher.poll({ callId, holdMs: 0 });
      expect(polled).not.toBeNull();
      expect(polled?.state).toBe("awaiting_permission");

      await dispatcher.sendPermission({
        conversationId,
        callId,
        decision: "allow_once",
      });

      const running = await dispatcher.read(callId);
      expect(running?.state).toBe("running");
      expect(running?.deadlineAt).toBe(clock.now + COMMAND_TIMEOUT_MS);
    });

    /** @scenario "A call waiting on a permission card keeps its envelope" */
    it("keeps the call in the conversation's pending set", async () => {
      const clock = { now: 1_752_600_100_000 };
      const { dispatcher, callId } = await callWaitingOnACard(clock);

      clock.now += ANSWER_DELAY_MS;

      const pending = await dispatcher.pendingEnvelopes(conversationId);
      expect(pending.map((envelope) => envelope.callId)).toEqual([callId]);
    });
  });
});
