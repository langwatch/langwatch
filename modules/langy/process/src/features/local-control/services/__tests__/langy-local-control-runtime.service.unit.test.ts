/**
 * Ending a turn's local work on Stop: one failing call never strands the rest. The Redis
 * outage is injected at the session store, as the dispatcher's own tests do.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { memorySessionState } from "@langwatch/process-stores";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";
import { describe, expect, it } from "vitest";

import { MemoryLangyLocalWorkspaceChannel } from "../../../../channels/memory/memory.langy-local-workspace.channel.ts";
import { MemoryLangyRepositories } from "../../../../repositories/memory/memory.langy.repositories.ts";
import { LangyLocalCallRedisRepository } from "../../../../repositories/redis/redis.langy-local-call.repository.ts";
import { LangyLocalPresenceRedisRepository } from "../../../../repositories/redis/redis.langy-local-presence.repository.ts";
import { callKey, pendingCallsKey } from "../../../../rules/langy-local-control-keys.rules.ts";
import { LangyLocalControlRuntimeService } from "../langy-local-control-runtime.service.ts";

const turn = { conversationId: "conv-1", turnId: "turn-1" };
const outage = new Error("redis connection reset");

/** A runtime over memory stores with two commands and one question card open on the turn. */
async function runtimeWithOpenWork() {
  const repositories = MemoryLangyRepositories.create();
  const ended: { waitId: string; outcome: string }[] = [];
  const store = memorySessionState();
  const failing = { key: undefined as string | undefined, listing: false };
  const flaky: SessionStateStore = {
    ...store,
    async set(key, value, ttlSeconds) {
      if (key === failing.key) throw outage;
      return store.set(key, value, ttlSeconds);
    },
    async zrangebyscore(key, min) {
      if (failing.listing && key === pendingCallsKey(turn.conversationId)) throw outage;
      return store.zrangebyscore(key, min);
    },
  };
  const presence = LangyLocalPresenceRedisRepository.create({ store });
  const runtime = LangyLocalControlRuntimeService.create({
    calls: LangyLocalCallRedisRepository.create({ store: flaky }),
    userWaits: repositories.localUserWaits,
    controlRequests: repositories.localControlRequests,
    presence,
    workspace: MemoryLangyLocalWorkspaceChannel.create(),
    projects: { getOrganizationId: async () => "org-1", getSlug: async () => "project" },
    mintSessionKey: async () => ({ token: "sk-lw-test", apiKeyId: "key-1" }),
    events: {
      startUserWait: async () => undefined,
      endUserWait: async (data) => void ended.push(data as { waitId: string; outcome: string }),
    },
    buffer: repositories.tokenBuffer.open(),
  });
  const now = Date.now();
  await presence.register({
    ...turn,
    projectId: "p1",
    userId: "user-1",
    requestId: "lcr_1",
    instanceId: "lci_1",
    hostname: "dev-laptop",
    connectedAt: now,
    lastSeenAt: now,
    workspace: { root: "/Users/dev/app", name: "app", os: "darwin" },
  });
  const question = await runtime.waits.startQuestion({
    projectId: "p1",
    ...turn,
    toolCallId: "toolu_q",
    questions: [{ question: "Which file?", options: [{ label: "a.ts" }] }],
  });
  const calls = [];
  for (const path of [".", "src"]) {
    calls.push(
      await runtime.dispatcher.start({
        projectId: "p1",
        ...turn,
        call: { tool: "local_ls", params: { path } },
        timeoutMs: 60_000,
      }),
    );
  }
  const stateOf = async (callId: string) => {
    const lookup = await runtime.dispatcher.getCall(callId);
    return lookup.kind === "hit" ? lookup.call.state : "gone";
  };
  return { runtime, ended, question, calls, failing, stateOf };
}

describe("cancelTurn", () => {
  describe("given the first call fails to cancel", () => {
    /** @scenario Stopping a turn ends what it left open on my machine */
    it("still cancels the later call and ends the waiting card", async () => {
      const { runtime, ended, question, calls, failing, stateOf } = await runtimeWithOpenWork();
      failing.key = callKey(calls[0]!.callId);

      await runtime.cancelTurn(turn);

      expect(await stateOf(calls[0]!.callId)).not.toBe("done");
      expect(await stateOf(calls[1]!.callId)).toBe("done");
      expect(ended).toEqual([
        expect.objectContaining({ waitId: question.waitId, outcome: "cancelled" }),
      ]);
    });
  });

  describe("given listing the turn's calls fails", () => {
    /** @scenario Stopping a turn ends what it left open on my machine */
    it("still ends the waiting card", async () => {
      const { runtime, ended, question, failing } = await runtimeWithOpenWork();
      failing.listing = true;

      await expect(runtime.cancelTurn(turn)).rejects.toThrow(outage);

      expect(ended).toEqual([
        expect.objectContaining({ waitId: question.waitId, outcome: "cancelled" }),
      ]);
    });
  });
});
