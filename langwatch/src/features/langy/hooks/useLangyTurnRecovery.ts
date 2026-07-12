import { useCallback, useEffect, useRef, useState } from "react";
import {
  canAutoRecover,
  isMutatingLangyTool,
  langyRecoveryPolicy,
} from "../logic/langyRecoveryPolicy";

/**
 * Drives the CLIENT half of Langy's turn recovery: owns the clock and the
 * attempt bookkeeping. The policy (`logic/langyRecoveryPolicy.ts`) is pure and
 * decides WHETHER and HOW LONG; this hook is the only thing here that knows
 * what time it is.
 *
 * Most failures never get here — the turn processor recovers them in process,
 * on the same stream (see `server/app-layer/langy/execution/langy-turn-recovery.ts`).
 * What reaches this hook is the two failures the server provably cannot fix
 * from inside itself: a draining pod (`langy_worker_restarting`) and a turn that
 * burned the whole attach budget (`langy_turn_timeout`).
 *
 * The retry re-drives the TURN. It must NOT re-post the user's message — that
 * message was persisted server-side before the turn ran, so a `sendMessage`
 * would append a second copy of the same question. `onRetry` is expected to be
 * `useChat`'s `regenerate`, which truncates the dead assistant message, keeps
 * the user's message where it is, and POSTs with `trigger: "regenerate-message"`
 * — which the chat route reads to skip `recordUserMessage`.
 *
 * The caller renders the calm recovering line while `isRecovering` is true and
 * holds the red error card back until it isn't.
 */

export interface LangyTurnRecovery {
  /** True while an auto-retry is scheduled — the error card must stay hidden. */
  isRecovering: boolean;
  /** The line to show in the message flow, or null when not recovering. */
  message: string | null;
  /** The attempt about to run (1-based). 0 when not recovering. */
  attempt: number;
  /** How many attempts this kind gets in total. */
  attempts: number;
  /**
   * Cancel any pending retry and forget the attempt budget. MUST be called when
   * the conversation changes out from under us (New chat, switch, delete) —
   * otherwise a timer armed by the OLD conversation fires `regenerate()` into
   * the NEW one, re-driving a turn the user has walked away from.
   */
  reset: () => void;
}

/** A tool part on a streamed assistant message. */
interface ToolBearingMessage {
  role: string;
  parts?: { type?: string }[];
}

/**
 * Did the failed turn already run a tool that CHANGES the project? The agent has
 * no idempotency key, so replaying such a turn can open a second PR or create a
 * second prompt. Read off the trailing assistant message's tool parts — the same
 * parts the tool cards render from.
 */
export function turnHadSideEffects(messages: ToolBearingMessage[]): boolean {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last?.parts) return false;
  return last.parts.some(
    (part) =>
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      isMutatingLangyTool(part.type),
  );
}

export function useLangyTurnRecovery({
  errorKind,
  errorId,
  sideEffectsObserved,
  onRetry,
  enabled = true,
}: {
  /** The failed turn's domain-error kind, or null when there is no error. */
  errorKind: string | null;
  /**
   * Identity of THIS failure. A new value means a new failure arrived (useChat
   * mints a fresh Error per failure, so its reference is the natural identity);
   * the same value across renders must not re-arm the timer.
   */
  errorId: unknown;
  /** Did the failed turn already run a project-mutating tool? */
  sideEffectsObserved: boolean;
  /** Re-drive the turn. Must NOT re-post the user's message. */
  onRetry: () => void;
  enabled?: boolean;
}): LangyTurnRecovery {
  // Attempts already spent on the CURRENT chain. A chain is the run of failures
  // between one user message and the next, so a bounded policy really is bounded
  // per question — `reset()` starts a new one.
  const attemptsUsedRef = useRef(0);
  const handledErrorRef = useRef<unknown>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  const [pending, setPending] = useState<{
    kind: string;
    attempt: number;
  } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    attemptsUsedRef.current = 0;
    handledErrorRef.current = null;
    setPending(null);
  }, [clearTimer]);

  useEffect(() => {
    // The failure cleared (the retry got going, or the user moved on): drop the
    // pending state but KEEP the attempt count — the chain is still open until
    // the user sends something new, so a policy of "2 attempts" stays 2.
    if (!errorKind || !enabled) {
      clearTimer();
      handledErrorRef.current = null;
      setPending(null);
      return;
    }

    // Same failure we already armed a timer for — don't re-arm on every render.
    if (handledErrorRef.current === errorId) return;
    handledErrorRef.current = errorId;

    const attemptsUsed = attemptsUsedRef.current;
    if (
      !canAutoRecover({ kind: errorKind, attemptsUsed, sideEffectsObserved })
    ) {
      // Terminal kind, exhausted budget, or a turn that already changed
      // something: the caller falls through to the error card.
      clearTimer();
      setPending(null);
      return;
    }

    const policy = langyRecoveryPolicy(errorKind);
    const attempt = attemptsUsed + 1;

    clearTimer();
    setPending({ kind: errorKind, attempt });
    timerRef.current = setTimeout(() => {
      clearTimer();
      attemptsUsedRef.current = attempt;
      setPending(null);
      // `regenerate` clears useChat's error and flips status to "submitted", so
      // the panel hands straight over to its normal thinking indicator.
      onRetryRef.current();
    }, policy.delayMs(attempt));

    return clearTimer;
  }, [errorKind, errorId, sideEffectsObserved, enabled, clearTimer]);

  // Unmount must never leave a timer holding a stale `regenerate`.
  useEffect(() => clearTimer, [clearTimer]);

  if (!pending) {
    return {
      isRecovering: false,
      message: null,
      attempt: 0,
      attempts: errorKind ? langyRecoveryPolicy(errorKind).attempts : 0,
      reset,
    };
  }

  const policy = langyRecoveryPolicy(pending.kind);
  return {
    isRecovering: true,
    message: policy.recoveringMessage,
    attempt: pending.attempt,
    attempts: policy.attempts,
    reset,
  };
}
