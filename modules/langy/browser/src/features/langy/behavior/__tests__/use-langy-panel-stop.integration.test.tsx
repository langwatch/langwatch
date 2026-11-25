/**
 * @vitest-environment jsdom
 *
 * A late stop answer settles only the turn it stopped, never one the tab moved on to.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stopAnswer: { resolve: () => void } = { resolve: () => undefined };
const invalidateMessages = vi.fn();

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({ langy: { messages: { invalidate: invalidateMessages } } }),
    langy: {
      stopTurn: {
        useMutation: () => ({
          mutateAsync: () =>
            new Promise<{ stopped: boolean }>((resolve) => {
              stopAnswer.resolve = () => resolve({ stopped: true });
            }),
        }),
      },
    },
  },
}));

const { useLangyStore } = await import("../../../../behavior/langy.store.ts");
const { useLangyPanelStop } = await import("../panel/use-langy-panel-stop.ts");

function startStoppedTurn() {
  const store = useLangyStore.getState();
  store.selectConversation("conv-1");
  store.beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
  store.setTurnStatus("Reading the traces");
}

async function pressStopAndAnswer(handleStop: () => void, moveOn: () => void): Promise<void> {
  act(() => handleStop());
  moveOn();
  await act(async () => {
    stopAnswer.resolve();
    await Promise.resolve();
  });
}

describe("useLangyPanelStop settling a stopped turn", () => {
  beforeEach(() => {
    useLangyStore.getState().resetForScope({});
    invalidateMessages.mockClear();
  });
  afterEach(() => useLangyStore.getState().resetForScope({}));

  describe("given the stop answers while the tab still holds the stopped turn", () => {
    /** @scenario A confirmed stop hands the composer back even when no update reaches the tab */
    it("settles it to idle and clears its live lines", async () => {
      startStoppedTurn();
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );

      await pressStopAndAnswer(result.current, () => undefined);

      expect(useLangyStore.getState().turnPhase).toBe("idle");
      expect(useLangyStore.getState().turnStatus).toBeNull();
    });
  });

  describe("given the tab moved on to a different turn when the stop answers", () => {
    /** @scenario A late stop answer leaves a newer turn alone */
    it("leaves that turn's composer state and live lines untouched", async () => {
      startStoppedTurn();
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );

      await pressStopAndAnswer(result.current, () => {
        const store = useLangyStore.getState();
        store.settleTurn("turn-1");
        store.beginTurn({ conversationId: "conv-1", turnId: "turn-2" });
        store.setTurnStatus("Newer turn working");
      });

      const after = useLangyStore.getState();
      expect(after.activeTurnId).toBe("turn-2");
      expect(after.turnPhase).toBe("active");
      expect(after.turnStatus).toBe("Newer turn working");
      expect(invalidateMessages).toHaveBeenCalled();
    });
  });

  describe("given a new send began, still unnamed, when the stop answers", () => {
    /** @scenario A late stop answer leaves a newer turn alone */
    it("does not settle the fresh send to idle", async () => {
      startStoppedTurn();
      const { result } = renderHook(() =>
        useLangyPanelStop({ projectId: "proj-1", foldInFlightTurnId: null, stop: async () => {} }),
      );

      await pressStopAndAnswer(result.current, () => {
        const store = useLangyStore.getState();
        store.settleTurn("turn-1");
        store.beginSend();
        store.setTurnStatus("Sending");
      });

      const after = useLangyStore.getState();
      expect(after.turnPhase).not.toBe("idle");
      expect(after.turnStatus).toBe("Sending");
    });
  });
});
