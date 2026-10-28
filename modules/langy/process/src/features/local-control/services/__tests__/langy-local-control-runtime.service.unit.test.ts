/**
 * Ending a turn's local work on Stop: one failing call never strands the rest.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { memorySessionState } from "@langwatch/process-stores";
import { describe, expect, it, vi } from "vitest";

import { MemoryLangyLocalWorkspaceChannel } from "../../../../channels/memory/memory.langy-local-workspace.channel.ts";
import { MemoryLangyRepositories } from "../../../../repositories/memory/memory.langy.repositories.ts";
import { LangyLocalPresenceRedisRepository } from "../../../../repositories/redis/redis.langy-local-presence.repository.ts";
import { LangyLocalControlRuntimeService } from "../langy-local-control-runtime.service.ts";

const turn = { conversationId: "conv-1", turnId: "turn-1" };

/** A real runtime over memory stores with two commands and one question card open on the turn. */
async function runtimeWithOpenWork() {
  const repositories = MemoryLangyRepositories.create();
  const ended: { waitId: string; outcome: string }[] = [];
  const presence = LangyLocalPresenceRedisRepository.create({ store: memorySessionState() });
  const runtime = LangyLocalControlRuntimeService.create({
    calls: repositories.localCalls,
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
  for (const path of [".", "src"]) {
    await runtime.dispatcher.start({
      projectId: "p1",
      ...turn,
      call: { tool: "local_ls", params: { path } },
      timeoutMs: 60_000,
    });
  }
  return { runtime, ended, question };
}

describe("cancelTurn", () => {
  describe("given the first call fails to cancel", () => {
    /** @scenario Stopping a turn ends what it left open on my machine */
    it("still cancels the later call and ends the waiting card", async () => {
      const { runtime, ended, question } = await runtimeWithOpenWork();
      const realCancel = runtime.dispatcher.cancel.bind(runtime.dispatcher);
      const cancel = vi
        .spyOn(runtime.dispatcher, "cancel")
        .mockRejectedValueOnce(new Error("redis connection reset"))
        .mockImplementation(realCancel);

      await runtime.cancelTurn(turn);

      expect(cancel).toHaveBeenCalledTimes(2);
      expect(ended).toEqual([
        expect.objectContaining({ waitId: question.waitId, outcome: "cancelled" }),
      ]);
      expect(await runtime.dispatcher.listPendingForTurn(turn)).toHaveLength(1);
    });
  });
});
