import {
  LangyConversationNotOwnedError,
  LangyTurnNotStoppableError,
} from "@langwatch/langy-contract";
/**
 * The durable Stop workflow: who may stop a turn, and what stopping it
 * records regardless of what the worker does. Ported from origin/main's
 * `LangyTurnService.stopTurn`. See specs/langy/langy-stop-and-resume.feature.
 */
import { memorySessionState } from "@langwatch/process-stores";
import { describe, expect, it, vi } from "vitest";

import {
  conversationDetail,
  langyTurnDependencies,
} from "../../../../__tests__/support/langy-turn-deps.ts";
import { MemoryLangyLocalWorkspaceChannel } from "../../../../channels/memory/memory.langy-local-workspace.channel.ts";
import { MemoryLangyRepositories } from "../../../../repositories/memory/memory.langy.repositories.ts";
import { LangyLocalPresenceRedisRepository } from "../../../../repositories/redis/redis.langy-local-presence.repository.ts";
import { LangyFinalPartsService } from "../../../../services/langy-final-parts.service.ts";
import { LangyLocalControlRuntimeService } from "../../../local-control/services/langy-local-control-runtime.service.ts";
import { LangyTurnStopService } from "../langy-turn-stop.service.ts";

function makeStopDeps(
  over: {
    isTurnActor?: boolean;
    isOwn?: boolean;
    currentTurnId?: string | null;
    deltas?: string[];
    cancelRejects?: boolean;
    emptyBuffer?: boolean;
    localWork?: {
      cancelTurn: (input: { conversationId: string; turnId: string }) => Promise<void>;
    };
  } = {},
) {
  const finalizeTurn = vi.fn(async (_args: Record<string, unknown>) => ({ messageId: "a1" }));
  const findByIdVisible = vi.fn(async () =>
    conversationDetail({
      isOwn: over.isOwn ?? true,
      currentTurnId: over.currentTurnId === undefined ? "turn-1" : over.currentTurnId,
    }),
  );
  const isTurnActor = vi.fn(async () => over.isTurnActor ?? true);
  const markEnd = vi.fn(async () => ({ backstopped: false }));
  const cancel = vi.fn(async () => {
    if (over.cancelRejects) throw new Error("worker unreachable");
  });
  const readTail = vi.fn(async () => ({
    reads: (over.deltas ?? ["half ", "an answer"]).map((text, i) => ({
      id: `${i}`,
      entry: { type: "delta" as const, text },
    })),
    lastId: "9",
  }));

  const deps = langyTurnDependencies({
    conversations: { finalizeTurn, findByIdVisible },
    credentials: {},
    worker: { cancel },
    tokenBuffer: over.emptyBuffer ? undefined : { readTail, markEnd },
    accessStore: { isTurnActor },
    messages: null,
    finalParts: LangyFinalPartsService.create(),
    ...(over.localWork ? { localWork: over.localWork } : {}),
  });

  return {
    deps,
    mocks: { finalizeTurn, findByIdVisible, isTurnActor, markEnd, cancel, readTail },
  };
}

/** A real local-control runtime over memory stores, with a folder connected for `conv-1`. */
async function localControlWithOpenWork() {
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
    conversationId: "conv-1",
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
    conversationId: "conv-1",
    turnId: "turn-1",
    toolCallId: "toolu_q",
    questions: [{ question: "Which file?", options: [{ label: "a.ts" }, { label: "b.ts" }] }],
  });
  const call = await runtime.dispatcher.start({
    projectId: "p1",
    conversationId: "conv-1",
    turnId: "turn-1",
    call: { tool: "local_ls", params: { path: "." } },
    timeoutMs: 60_000,
  });
  const otherTurnsQuestion = await runtime.waits.startQuestion({
    projectId: "p1",
    conversationId: "conv-1",
    turnId: "turn-0",
    toolCallId: "toolu_old",
    questions: [{ question: "Older?", options: [{ label: "yes" }] }],
  });
  return { runtime, ended, question, call, otherTurnsQuestion };
}

const stopArgs = {
  projectId: "p1",
  conversationId: "conv-1",
  turnId: "turn-1",
  userId: "user-1",
};

describe("LangyTurnStopService.stopTurn", () => {
  describe("given the caller is the turn's actor", () => {
    /** @scenario Stopping a turn ends it on the backend, not just in my browser */
    /** @scenario Stopping asks the worker to abandon the running generation */
    it("records a stopped terminal carrying the partial answer, ends the stream, and asks the worker to cancel", async () => {
      const { deps, mocks } = makeStopDeps({ isTurnActor: true });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      const call = mocks.finalizeTurn.mock.calls[0]![0] as {
        outcome: string;
        parts: { text?: string }[];
      };
      expect(call.outcome).toBe("stopped");
      // The partial answer is the joined durable delta tail, preserved verbatim.
      expect(call.parts.map((p) => p.text ?? "").join("")).toBe("half an answer");
      expect(mocks.markEnd).toHaveBeenCalledTimes(1);
      expect(mocks.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conv-1", turnId: "turn-1" }),
      );
      // The actor short-circuits the ownership read.
      expect(mocks.findByIdVisible).not.toHaveBeenCalled();
    });
  });

  describe("given the caller is neither the actor nor the owner", () => {
    /** @scenario Only someone who can control the conversation may stop its turn */
    it("refuses with a handled not-owned error and records no terminal", async () => {
      const { deps, mocks } = makeStopDeps({ isTurnActor: false, isOwn: false });

      await expect(LangyTurnStopService.create(deps).stopTurn(stopArgs)).rejects.toBeInstanceOf(
        LangyConversationNotOwnedError,
      );
      expect(mocks.finalizeTurn).not.toHaveBeenCalled();
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.markEnd).not.toHaveBeenCalled();
    });
  });

  describe("given the caller owns the conversation but did not start the turn", () => {
    it("allows the stop when they name the turn the record has in flight", async () => {
      const { deps, mocks } = makeStopDeps({
        isTurnActor: false,
        isOwn: true,
        currentTurnId: "turn-1",
      });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
    });

    describe("when the named turn is not the one in flight", () => {
      /** @scenario A stop naming a turn that is not the one in flight is refused */
      it("refuses instead of writing a durable terminal for an unproven turn id", async () => {
        const { deps, mocks } = makeStopDeps({
          isTurnActor: false,
          isOwn: true,
          currentTurnId: "some-other-turn",
        });

        await expect(LangyTurnStopService.create(deps).stopTurn(stopArgs)).rejects.toBeInstanceOf(
          LangyTurnNotStoppableError,
        );
        expect(mocks.finalizeTurn).not.toHaveBeenCalled();
        expect(mocks.markEnd).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();
      });

      it("refuses when the conversation has no turn in flight at all", async () => {
        const { deps } = makeStopDeps({
          isTurnActor: false,
          isOwn: true,
          currentTurnId: null,
        });

        await expect(LangyTurnStopService.create(deps).stopTurn(stopArgs)).rejects.toBeInstanceOf(
          LangyTurnNotStoppableError,
        );
      });
    });
  });

  describe("given the caller IS the turn's actor", () => {
    it("stops without consulting the record — the live-access grant already proved the turn", async () => {
      const { deps, mocks } = makeStopDeps({ isTurnActor: true, currentTurnId: null });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(mocks.findByIdVisible).not.toHaveBeenCalled();
      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the worker cancel fails", () => {
    it("still records the stop — the durable terminal is what makes it truthful", async () => {
      const { deps, mocks } = makeStopDeps({ cancelRejects: true });

      await expect(LangyTurnStopService.create(deps).stopTurn(stopArgs)).resolves.toBeUndefined();
      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.markEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the turn left a question card open and a command running on my machine", () => {
    /** @scenario Stopping a turn ends what it left open on my machine */
    it("ends the card as cancelled and the command as stopped, and leaves other turns alone", async () => {
      const local = await localControlWithOpenWork();
      const { deps } = makeStopDeps({
        localWork: { cancelTurn: (input) => local.runtime.cancelTurn(input) },
      });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(
        await local.runtime.waits.listPending({ conversationId: "conv-1", turnId: "turn-1" }),
      ).toEqual([]);
      expect(local.ended).toEqual([
        expect.objectContaining({ waitId: local.question.waitId, outcome: "cancelled" }),
      ]);
      expect(
        await local.runtime.dispatcher.listPendingForTurn({
          conversationId: "conv-1",
          turnId: "turn-1",
        }),
      ).toEqual([]);
      expect(
        (await local.runtime.waits.listPending({ conversationId: "conv-1", turnId: "turn-0" })).map(
          (wait) => wait.waitId,
        ),
      ).toEqual([local.otherTurnsQuestion.waitId]);
    });

    /** @scenario Stopping a turn ends what it left open on my machine */
    it("still records the stop when ending the local work fails", async () => {
      const { deps, mocks } = makeStopDeps({
        localWork: {
          cancelTurn: async () => {
            throw new Error("redis connection reset");
          },
        },
      });

      await expect(LangyTurnStopService.create(deps).stopTurn(stopArgs)).resolves.toBeUndefined();
      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.cancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the live buffer holds no partial answer", () => {
    it("still records a stopped terminal, with an empty answer", async () => {
      const { deps, mocks } = makeStopDeps({ emptyBuffer: true });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeTurn.mock.calls[0]![0]).toMatchObject({ outcome: "stopped" });
    });
  });
});
