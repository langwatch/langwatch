// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyTurnRecovery } from "../hooks/useLangyTurnRecovery";
import { langyRecoveryPolicy } from "../logic/langyRecoveryPolicy";

/**
 * The hook owns the CLOCK. The policy decides whether and how long; this decides
 * when — and, critically, when NOT to: a retry armed by a conversation the user
 * has walked away from must never fire into the one they opened next.
 */

const RESTARTING = "langy_worker_restarting";

function setup({
  errorKind = RESTARTING as string | null,
  errorId = { id: 1 } as unknown,
  sideEffectsObserved = false,
  onRetry = vi.fn(),
}) {
  const result = renderHook(
    (props: {
      errorKind: string | null;
      errorId: unknown;
      sideEffectsObserved: boolean;
    }) =>
      useLangyTurnRecovery({
        errorKind: props.errorKind,
        errorId: props.errorId,
        sideEffectsObserved: props.sideEffectsObserved,
        onRetry,
      }),
    { initialProps: { errorKind, errorId, sideEffectsObserved } },
  );
  return { ...result, onRetry };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useLangyTurnRecovery", () => {
  describe("given a deploy restarted the worker mid-turn", () => {
    it("shows a calm recovering line instead of an error, then re-drives the turn", () => {
      const { result, onRetry } = setup({});

      expect(result.current.isRecovering).toBe(true);
      expect(result.current.message).toContain("picking up where it left off");
      expect(onRetry).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(result.current.isRecovering).toBe(false);
    });

    it("gives up to the error card once its attempts are spent", () => {
      const { result, rerender, onRetry } = setup({});
      const policy = langyRecoveryPolicy(RESTARTING);

      for (let attempt = 1; attempt <= policy.attempts; attempt++) {
        act(() => {
          vi.advanceTimersByTime(policy.delayMs(attempt));
        });
        // Each retry fails again: a NEW error object arrives.
        rerender({
          errorKind: RESTARTING,
          errorId: { id: attempt + 1 },
          sideEffectsObserved: false,
        });
      }

      expect(onRetry).toHaveBeenCalledTimes(policy.attempts);
      // Budget spent: no more recovering line — the caller falls through to the
      // card with its manual "Try again".
      expect(result.current.isRecovering).toBe(false);
    });
  });

  describe("when an auto-retryable failure first arrives", () => {
    it("reports willAutoRecover on the very first render, before the timer arms — so the card never flashes", () => {
      // The flicker: `isRecovering` is timer-driven, so on the first paint of a
      // fresh failure it is still false; a panel gating the red card on
      // `!isRecovering` alone rendered it for that one frame before the retry
      // armed. `willAutoRecover` is synchronous, so the panel can hold the card
      // out from the very first frame.
      const { result } = setup({});
      expect(result.current.willAutoRecover).toBe(true);
    });

    it("does not report willAutoRecover for a terminal worker-stopped failure", () => {
      const { result } = setup({ errorKind: "langy_worker_stopped" });
      expect(result.current.willAutoRecover).toBe(false);
      expect(result.current.isRecovering).toBe(false);
    });

    it("stops reporting willAutoRecover once the turn changed something", () => {
      const { result } = setup({ sideEffectsObserved: true });
      expect(result.current.willAutoRecover).toBe(false);
    });
  });

  describe("when the same error re-renders", () => {
    it("does not re-arm the timer — one failure, one retry", () => {
      const errorId = { id: 1 };
      const { rerender, onRetry } = setup({ errorId });

      rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: false });
      rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: false });

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the failed turn already changed something", () => {
    it("refuses to auto-retry — the replay is the user's call", () => {
      const { result, onRetry } = setup({ sideEffectsObserved: true });

      expect(result.current.isRecovering).toBe(false);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("when the failure is terminal", () => {
    it("never schedules a retry for a lost session", () => {
      const { result, onRetry } = setup({
        errorKind: "langy_agent_session_lost",
      });
      expect(result.current.isRecovering).toBe(false);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("never schedules a retry for an unknown failure", () => {
      const { onRetry } = setup({ errorKind: "unknown" });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRetry).not.toHaveBeenCalled();
    });

    it("never retries at-capacity or unavailable — the server already did", () => {
      for (const kind of [
        "langy_agent_at_capacity",
        "langy_agent_unavailable",
      ]) {
        const onRetry = vi.fn();
        setup({ errorKind: kind, onRetry });
        act(() => {
          vi.advanceTimersByTime(60_000);
        });
        expect(onRetry, kind).not.toHaveBeenCalled();
      }
    });
  });

  describe("when the user starts a new chat while a retry is pending", () => {
    it("cancels it — a retry MUST NOT fire into the conversation they opened next", () => {
      // The nastiest failure mode in the New-chat reset: a timer armed by the
      // old conversation calls regenerate() against the new one, re-driving a
      // turn the user walked away from. `reset()` is what the panel's
      // `resetChatEngine` calls to make it impossible.
      const { result, onRetry } = setup({});
      expect(result.current.isRecovering).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isRecovering).toBe(false);

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(onRetry).not.toHaveBeenCalled();
    });

    it("hands the next conversation a full attempt budget", () => {
      const { result, rerender, onRetry } = setup({});
      const policy = langyRecoveryPolicy(RESTARTING);

      // Spend one attempt, then walk away.
      act(() => {
        vi.advanceTimersByTime(policy.delayMs(1));
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
      act(() => {
        result.current.reset();
      });

      // A failure in the NEW conversation gets the whole budget back.
      rerender({
        errorKind: RESTARTING,
        errorId: { id: 99 },
        sideEffectsObserved: false,
      });
      expect(result.current.isRecovering).toBe(true);
      expect(result.current.attempt).toBe(1);
    });
  });

  describe("when the panel unmounts with a retry pending", () => {
    it("does not fire the retry", () => {
      const { unmount, onRetry } = setup({});
      unmount();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRetry).not.toHaveBeenCalled();
    });
  });
});
