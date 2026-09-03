/**
 * The durable Stop workflow: who may stop a turn, and what stopping it
 * records regardless of what the worker does.
 *
 * Ported from platform/app/src/server/app-layer/langy/__tests__/langy-turn.service.unit.test.ts
 * (origin/main)'s `LangyTurnService.stopTurn` block, adapted to the
 * split-out `LangyTurnStopService`. See specs/langy/langy-stop-and-resume.feature.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LangyConversationNotOwnedError,
  LangyTurnNotStoppableError,
} from "@langwatch/langy-contract";
import { LangyTurnStopService } from "../langy-turn-stop.service";
import { LangyFinalPartsService } from "../langy-final-parts.service";
import type { LangyTurnServiceDependencies } from "../langy-turn.shared";

function makeStopDeps(
  over: {
    isTurnActor?: boolean;
    isOwn?: boolean;
    currentTurnId?: string | null;
    deltas?: string[];
    cancelRejects?: boolean;
    noBuffer?: boolean;
  } = {},
) {
  const finalizeTurn = vi.fn(async (_args: Record<string, unknown>) => ({ messageId: "a1" }));
  const tryFindByIdVisible = vi.fn(async () => ({
    isOwn: over.isOwn ?? true,
    currentTurnId: over.currentTurnId === undefined ? "turn-1" : over.currentTurnId,
  }));
  const isTurnActor = vi.fn(async () => over.isTurnActor ?? true);
  const markEnd = vi.fn(async () => {});
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

  const deps = {
    conversations: { finalizeTurn, tryFindByIdVisible } as unknown,
    credentials: {} as unknown,
    worker: { cancel } as unknown,
    tokenBuffer: over.noBuffer ? null : ({ readTail, markEnd } as unknown),
    accessStore: { isTurnActor } as unknown,
    handoffStore: null,
    messages: null,
    finalParts: LangyFinalPartsService.create(),
  } as unknown as LangyTurnServiceDependencies;

  return {
    deps,
    mocks: { finalizeTurn, tryFindByIdVisible, isTurnActor, markEnd, cancel, readTail },
  };
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
        parts: Array<{ text?: string }>;
      };
      expect(call.outcome).toBe("stopped");
      // The partial answer is the joined durable delta tail, preserved verbatim.
      expect(call.parts.map((p) => p.text ?? "").join("")).toBe("half an answer");
      expect(mocks.markEnd).toHaveBeenCalledTimes(1);
      expect(mocks.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conv-1", turnId: "turn-1" }),
      );
      // The actor short-circuits the ownership read.
      expect(mocks.tryFindByIdVisible).not.toHaveBeenCalled();
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

      expect(mocks.tryFindByIdVisible).not.toHaveBeenCalled();
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

  describe("when there is no live buffer to read a partial from", () => {
    it("still records a stopped terminal, with an empty answer", async () => {
      const { deps, mocks } = makeStopDeps({ noBuffer: true });

      await LangyTurnStopService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeTurn.mock.calls[0]![0]).toMatchObject({ outcome: "stopped" });
    });
  });
});
