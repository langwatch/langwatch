/**
 * @vitest-environment jsdom
 *
 * A connection lost while the turn still runs is followed, not reported as a failed turn.
 * @see specs/langy/langy-turn-recovery.feature
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: { useUtils: () => ({ langy: { messages: { invalidate: vi.fn() } } }) },
}));
vi.mock("@langwatch/browser-host/use-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { useLangyStore } = await import("../../../../behavior/langy.store.ts");
const { useLangyTurnFailure } = await import("../panel/use-langy-turn-failure.ts");

const CONNECTION_LOST = new Error("SSE connection failed after 5 attempts");

function recordTurn(status: string) {
  useLangyStore.setState({
    turnProjection: {
      ...useLangyStore.getState().turnProjection,
      turnId: "turn-1",
      turn: { ...useLangyStore.getState().turnProjection.turn, Status: status },
    } as ReturnType<typeof useLangyStore.getState>["turnProjection"],
  });
}

function renderFailure({
  error,
  durableLastError = null,
}: {
  error: Error;
  durableLastError?: string | null;
}) {
  const restoreDraftOnFailure = vi.fn();
  const hook = renderHook(
    ({ turnActive }: { turnActive: boolean }) =>
      useLangyTurnFailure({
        error,
        isBusy: false,
        turnActive,
        durableLastError,
        messages: [],
        retryEngineTurn: vi.fn(),
        restoreDraftOnFailure,
      }),
    { initialProps: { turnActive: true } },
  );
  return { ...hook, restoreDraftOnFailure };
}

describe("useLangyTurnFailure when the connection to a running turn is lost", () => {
  beforeEach(() => {
    const store = useLangyStore.getState();
    store.resetForScope({});
    store.selectConversation("conv-1");
    store.beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
    recordTurn("running");
  });
  afterEach(() => useLangyStore.getState().resetForScope({}));

  describe("given the record still holds the turn as running", () => {
    /** @scenario A lost connection follows the running turn instead of failing it */
    it("shows no error card, keeps the working line and keeps the composer locked", () => {
      const { result, restoreDraftOnFailure } = renderFailure({ error: CONNECTION_LOST });

      expect(result.current.turnError).toBeNull();
      expect(result.current.liveTurnInFlight).toBe(true);
      expect(restoreDraftOnFailure).not.toHaveBeenCalled();
    });

    /** @scenario A lost connection follows the running turn instead of failing it */
    it("keeps following after the record says complete, until the transcript replaces the reply", () => {
      const { result, rerender } = renderFailure({ error: CONNECTION_LOST });

      recordTurn("completed");
      rerender({ turnActive: false });

      expect(result.current.turnError).toBeNull();
    });
  });

  describe("given the record says the turn failed", () => {
    /** @scenario A turn that really failed keeps its error card */
    it("shows the card for the recorded failure", () => {
      const { result, rerender } = renderFailure({
        error: CONNECTION_LOST,
        durableLastError: JSON.stringify({ code: "langy_turn_timeout", httpStatus: 504 }),
      });

      recordTurn("failed");
      rerender({ turnActive: false });

      expect(result.current.turnError?.kind).toBe("langy_turn_timeout");
    });
  });
});
