/**
 * @vitest-environment node
 * The envelope now outlives the command's time limit for as long as its permission ask stays open.
 * @see specs/langy/langy-local-control.feature
 */

import { SessionStateStoreFactory } from "@langwatch/redis-client";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { beforeEach, describe, expect, it } from "vitest";

import { LangyLocalPresenceRedisRepository } from "../../repositories/redis/redis.langy-local-presence.repository.ts";
import { LocalCallDispatcherService } from "../langy-local-call-dispatcher.service.ts";

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
  const store: SessionStateStore = SessionStateStoreFactory.memory({
    now: () => clock.now,
  });
  const presence = LangyLocalPresenceRedisRepository.create({ store, now: () => clock.now });
  await presence.register(connectedFolder(clock.now));
  const dispatcher = LocalCallDispatcherService.create({
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

type WaitingCall = Awaited<ReturnType<typeof callWaitingOnACard>>;

describe("given a call waiting on a permission card", () => {
  describe("when the developer answers long after the command's own limit", () => {
    let clock: { now: number };
    let dispatcher: WaitingCall["dispatcher"];
    let callId: WaitingCall["callId"];

    beforeEach(async () => {
      clock = { now: 1_752_600_100_000 };
      ({ dispatcher, callId } = await callWaitingOnACard(clock));
      clock.now += ANSWER_DELAY_MS;
    });

    /** @scenario "A call waiting on a permission card keeps its envelope" */
    it("still holds the call, and gives the command its whole limit again", async () => {
      const waiting = await dispatcher.read(callId);
      expect(waiting?.state).toBe("awaiting_permission");
      const polled = await dispatcher.poll({ callId, holdMs: 0 });
      expect(polled).toMatchObject({ outcome: "polled", answer: { state: "awaiting_permission" } });

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
      const pending = await dispatcher.pendingEnvelopes(conversationId);
      expect(pending.map((envelope) => envelope.callId)).toEqual([callId]);
    });
  });
});
