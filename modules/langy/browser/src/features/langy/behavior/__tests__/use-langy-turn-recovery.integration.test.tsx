/**
 * The client half of turn recovery: which failures re-drive the turn on their own, and that
 * the error card is never drawn for one that will.
 * @vitest-environment jsdom
 * @see specs/langy/langy-turn-recovery.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LangyTurnRecovery, useLangyTurnRecovery } from "../use-langy-turn-recovery.ts";

const FAILURE = new Error("the turn failed");

/** Every handle the hook returned, in render order, so the very first render can be read. */
function renderRecovery({
  errorKind,
  sideEffectsObserved = false,
}: {
  errorKind: string;
  sideEffectsObserved?: boolean;
}) {
  const onRetry = vi.fn();
  const renders: LangyTurnRecovery[] = [];
  const hook = renderHook(() => {
    const recovery = useLangyTurnRecovery({
      errorKind,
      errorId: FAILURE,
      sideEffectsObserved,
      onRetry,
    });
    renders.push(recovery);
    return recovery;
  });
  return { ...hook, onRetry, renders };
}

const waitOutEveryRetry = () => {
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
};

describe("useLangyTurnRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a failure of a kind Langy retries on its own", () => {
    /** @scenario "An about-to-retry failure never flashes the error card" */
    it("knows from the first render that the card must stay hidden, and shows the recovering line", () => {
      const { renders, result, onRetry } = renderRecovery({ errorKind: "langy_worker_restarting" });

      expect(renders[0]!.willAutoRecover).toBe(true);
      expect(result.current.isRecovering).toBe(true);
      expect(result.current.message).toBe("Langy restarted — picking up where it left off…");
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("re-drives the turn once the wait has passed, through the retry and not a new send", () => {
      const { onRetry } = renderRecovery({ errorKind: "langy_worker_restarting" });

      act(() => {
        vi.advanceTimersByTime(1_500);
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the worker stopped mid-reply", () => {
    /** @scenario "The worker stops mid-reply and Langy shows a final, specific error" */
    it("never re-drives the turn, and never hides the card behind a recovering line", () => {
      const { renders, result, onRetry } = renderRecovery({ errorKind: "langy_worker_stopped" });
      waitOutEveryRetry();

      expect(renders.every((render) => !render.willAutoRecover && !render.isRecovering)).toBe(true);
      expect(result.current.message).toBeNull();
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("given Langy lost the session backing the conversation", () => {
    /** @scenario "A lost session is terminal and is never retried" */
    it("draws the card at once and never retries into the same wall", () => {
      const { renders, onRetry } = renderRecovery({ errorKind: "langy_agent_session_lost" });
      waitOutEveryRetry();

      expect(renders[0]!.willAutoRecover).toBe(false);
      expect(renders.some((render) => render.isRecovering)).toBe(false);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("given a failure of a kind Langy does not recognise", () => {
    /** @scenario "An unrecognised failure is never retried" */
    it.each(["unknown", "a_kind_added_tomorrow"])("never retries %s", (errorKind) => {
      const { renders, onRetry } = renderRecovery({ errorKind });
      waitOutEveryRetry();

      expect(renders[0]!.willAutoRecover).toBe(false);
      expect(renders.some((render) => render.isRecovering)).toBe(false);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("given the turn already ran a tool that changes the project", () => {
    /** @scenario "A turn that already changed something is not silently replayed" */
    it("leaves an otherwise-recoverable failure to the error card, so the replay is the user's call", () => {
      const { renders, onRetry } = renderRecovery({
        errorKind: "langy_worker_restarting",
        sideEffectsObserved: true,
      });
      waitOutEveryRetry();

      expect(renders[0]!.willAutoRecover).toBe(false);
      expect(renders.some((render) => render.isRecovering)).toBe(false);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });
});
