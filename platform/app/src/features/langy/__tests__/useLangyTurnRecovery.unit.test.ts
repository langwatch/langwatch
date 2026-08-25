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

  describe("when the history poll lands while a retry is already armed", () => {
    // `sideEffectsObserved` is derived from the engine's messages, and the 3s
    // `langy.messages` poll replaces those wholesale — well inside the
    // 1500/4000ms waits. So this is the ONE input that arrives after the timer
    // arms, and the two ways of getting it wrong are opposite failures.
    //
    // Cancelling the armed timer on that churn and then short-circuiting on
    // "same failure" left `pending` set forever: the recovering line stayed up,
    // the retry never fired, and the error card was suppressed behind it — the
    // only escape was sending a new message. Ignoring the churn entirely is the
    // other one: the retry fires on evidence it has already been shown to be
    // wrong about, and re-drives a turn that opened a PR.
    describe("when the poll shows nothing that changed the project", () => {
      it("still fires the retry it armed", () => {
        const errorId = { id: 1 };
        const { result, rerender, onRetry } = setup({ errorId });
        expect(result.current.isRecovering).toBe(true);

        // Same failure, fresh message list, same verdict: nothing here may
        // disturb a retry that is already scheduled.
        rerender({
          errorKind: RESTARTING,
          errorId,
          sideEffectsObserved: false,
        });

        act(() => {
          vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
        });

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(result.current.isRecovering).toBe(false);
      });
    });

    describe("when the poll reveals the turn already changed something", () => {
      it("abandons the armed retry rather than replay a mutating turn", () => {
        // The evidence is LATE by construction: the mutating tool call reaches
        // the browser on the poll, seconds after the stream died. Read only at
        // arming time, the guard misses it entirely and the timer re-drives a
        // turn that already opened a PR — a second PR, with no idempotency key
        // anywhere in the loop to collapse them.
        const errorId = { id: 1 };
        const { result, rerender, onRetry } = setup({ errorId });
        expect(result.current.isRecovering).toBe(true);

        rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: true });

        act(() => {
          vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
        });

        expect(onRetry).not.toHaveBeenCalled();
        // And it lands where an arming-time rejection lands: no recovering
        // line, so the caller falls through to the card and the replay becomes
        // the user's call.
        expect(result.current.isRecovering).toBe(false);
        expect(result.current.willAutoRecover).toBe(false);
        expect(result.current.message).toBeNull();
      });

      it("charges no attempt for the retry it did not run", () => {
        // The budget belongs to attempts actually made. Burning one here would
        // silently halve what a genuinely retryable failure gets next.
        const errorId = { id: 1 };
        const { result, rerender } = setup({ errorId });

        rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: true });
        act(() => {
          vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
        });

        // A fresh failure, with the mutating turn behind it: full budget back.
        rerender({
          errorKind: RESTARTING,
          errorId: { id: 2 },
          sideEffectsObserved: false,
        });
        expect(result.current.isRecovering).toBe(true);
        expect(result.current.attempt).toBe(1);
      });
    });

    it("never leaves the panel stuck on the recovering line", () => {
      const errorId = { id: 1 };
      const { result, rerender } = setup({ errorId });

      rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: true });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      // Whichever way it resolves — retried, or fallen through to the card —
      // it must not still be claiming to recover a minute later.
      expect(result.current.isRecovering).toBe(false);
      expect(result.current.message).toBeNull();
    });
  });

  describe("given the durable record reclassifies the failure it already saw", () => {
    // A failure's kind is not settled when its Error is minted. The panel
    // resolves the kind through `resolveLiveTurnError`, whose last road reads
    // the turn's real classification off the DURABLE record — which arrives on
    // the history poll, seconds after the stream died with nothing typed on it.
    // So the SAME Error object is explained as `unknown` first and as the real
    // kind second, and a guard that keys on the error's identity alone treats
    // the second, correct classification as old news.
    describe("when a terminal classification is replaced by an auto-recoverable one", () => {
      it("arms the retry for the kind that actually arrived", () => {
        const errorId = new Error("stream closed");
        const { result, rerender, onRetry } = setup({
          errorKind: "unknown",
          errorId,
        });
        expect(result.current.isRecovering).toBe(false);

        // The poll lands: same Error, the server's own classification.
        rerender({
          errorKind: RESTARTING,
          errorId,
          sideEffectsObserved: false,
        });

        expect(result.current.isRecovering).toBe(true);
        act(() => {
          vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
        });
        expect(onRetry).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the reclassification changes which policy applies", () => {
      it("retries on the new kind's budget, not the one already armed", () => {
        const errorId = new Error("stream closed");
        const { result, rerender, onRetry } = setup({ errorId });
        expect(result.current.isRecovering).toBe(true);

        rerender({
          errorKind: "langy_turn_timeout",
          errorId,
          sideEffectsObserved: false,
        });

        // The restart policy's first wait is shorter than the timeout policy's.
        // A timer left over from the restart classification would fire here.
        act(() => {
          vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
        });
        expect(onRetry).not.toHaveBeenCalled();
        expect(result.current.message).toContain("Taking another run");

        act(() => {
          vi.advanceTimersByTime(
            langyRecoveryPolicy("langy_turn_timeout").delayMs(1) -
              langyRecoveryPolicy(RESTARTING).delayMs(1),
          );
        });
        expect(onRetry).toHaveBeenCalledTimes(1);
      });
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
      for (const kind of ["langy_agent_at_capacity", "langy_agent_unavailable"]) {
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

  describe("when nothing about the failure changed", () => {
    // The hook's handle only changes when the recovery state does — the
    // contract that lets a consumer put it in a dep array, or hand it to a
    // memo'd child, without churning on every render.
    //
    // The panel used to do exactly that (`onChoiceSelect`, which goes to every
    // memo(MessageContent) in the column): a fresh object literal per render
    // made that callback fresh per render, so memo bought nothing and a
    // streaming turn re-ran every message's tool-part scan on every token. That
    // callback now comes off an implementation-ref, so no consumer reads the
    // identity today — which is precisely why it is pinned here rather than
    // left to be rediscovered the expensive way.
    it("hands back the same handle, so a consumer's dep array does not churn", () => {
      const errorId = { id: 1 };
      const { result, rerender } = setup({ errorId });
      const first = result.current;

      rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: false });
      rerender({ errorKind: RESTARTING, errorId, sideEffectsObserved: false });

      expect(result.current).toBe(first);
    });

    it("hands back a new one when the recovery state actually moves", () => {
      const { result } = setup({});
      const recovering = result.current;
      expect(recovering.isRecovering).toBe(true);

      act(() => {
        vi.advanceTimersByTime(langyRecoveryPolicy(RESTARTING).delayMs(1));
      });

      expect(result.current).not.toBe(recovering);
      expect(result.current.isRecovering).toBe(false);
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
