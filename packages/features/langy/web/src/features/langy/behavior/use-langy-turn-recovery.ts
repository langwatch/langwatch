import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canAutoRecover,
  isMutatingLangyTool,
  langyRecoveryPolicy,
} from "./logic/langy-recovery-policy";

/**
 * Drives the CLIENT half of Langy's turn recovery: owns the clock and the attempt
 * bookkeeping. The policy (`logic/langy-recovery-policy.ts`) is pure and decides
 * WHETHER and HOW LONG; this hook is the only thing here that knows what time it is.
 */

export interface LangyTurnRecovery {
  /** True while an auto-retry is scheduled — the error card must stay hidden. */
  isRecovering: boolean;
  /**
   * Derived SYNCHRONOUSLY during render (not from the timer effect): will this failure
   * auto-retry?
   */
  willAutoRecover: boolean;
  /** The line to show in the message flow, or null when not recovering. */
  message: string | null;
  /** The attempt about to run (1-based). 0 when not recovering. */
  attempt: number;
  /** How many attempts this kind gets in total. */
  attempts: number;
  /**
   * Cancel any pending retry and forget the attempt budget.
   */
  reset: () => void;
}

/** A tool part on a streamed assistant message. */
interface ToolBearingMessage {
  role: string;
  parts?: { type?: string }[];
}

/**
 * Did the failed turn already run a tool that CHANGES the project? The agent has no
 * idempotency key, so replaying such a turn can open a second PR or create a second
 * prompt.
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
   * Identity of THIS failure. A new value means a new failure arrived (useChat mints a
   * fresh Error per failure, so its reference is the natural identity); the same value
   * across renders must not re-arm the timer.
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
  /**
   * The failure this hook has already acted on, as the PAIR (kind, id) — never the id
   * alone.
   */
  const handledFailureRef = useRef<{ kind: string; id: unknown } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  // The one input that arrives LATE by construction, so it is read TWICE and is
  // deliberately kept out of the effect's dep array.
  const sideEffectsObservedRef = useRef(sideEffectsObserved);
  sideEffectsObservedRef.current = sideEffectsObserved;

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
    handledFailureRef.current = null;
    setPending(null);
  }, [clearTimer]);

  useEffect(() => {
    // The failure cleared (the retry got going, or the user moved on): drop the
    // pending state but KEEP the attempt count — the chain is still open until
    // the user sends something new, so a policy of "2 attempts" stays 2.
    if (!errorKind || !enabled) {
      clearTimer();
      handledFailureRef.current = null;
      setPending(null);
      return;
    }

    // Same failure, same classification: we already decided what to do with it,
    // so don't re-arm on every render. A CHANGED kind is a different decision
    // even on the same Error object — see `handledFailureRef`.
    const handled = handledFailureRef.current;
    if (handled && handled.id === errorId && handled.kind === errorKind) return;
    handledFailureRef.current = { kind: errorKind, id: errorId };

    const attemptsUsed = attemptsUsedRef.current;
    if (
      !canAutoRecover({
        kind: errorKind,
        attemptsUsed,
        sideEffectsObserved: sideEffectsObservedRef.current,
      })
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
      // LAST-MOMENT SAFETY RE-READ. Everything else the policy weighs was settled when
      // the timer armed; this one was not.
      if (sideEffectsObservedRef.current) {
        setPending(null);
        return;
      }
      attemptsUsedRef.current = attempt;
      setPending(null);
      // `regenerate` clears useChat's error and flips status to "submitted", so
      // the panel hands straight over to its normal thinking indicator.
      onRetryRef.current();
    }, policy.delayMs(attempt));

    // NO CLEANUP, on purpose. An armed timer belongs to the FAILURE (identified
    // by kind + `errorId`), not to this effect instance, and every way a retry
    // can legitimately be cancelled already clears it by hand: the failure
    // clearing or the hook being disabled (the first branch), a NEW failure
    // arriving — including the same Error reclassified — or one that turns out
    // to be terminal (both above), late-arriving side-effect evidence (the
    // callback's own re-read), `reset()` when the conversation changes, and the
    // unmount effect below.
    //
    // Returning `clearTimer` here instead is what wedged the panel: React runs
    // the previous cleanup on ANY dep change, so a re-render killed the pending
    // timer and then hit the same-failure short-circuit above, which re-arms
    // nothing. `pending` stayed set forever — `isRecovering` permanently true,
    // the retry never fired, and the error card stayed suppressed behind a
    // recovering line that could only be escaped by sending a new message.
  }, [errorKind, errorId, enabled, clearTimer]);

  // Unmount must never leave a timer holding a stale `regenerate`.
  useEffect(() => clearTimer, [clearTimer]);

  // SYNCHRONOUS: will THIS failure be handled by an automatic retry? Decided from the
  // same inputs the effect uses but WITHOUT waiting for it to run.
  const willAutoRecover =
    !!errorKind &&
    enabled &&
    canAutoRecover({
      kind: errorKind,
      attemptsUsed: attemptsUsedRef.current,
      sideEffectsObserved,
    });

  // MEMOISED so the handle is as stable as the state behind it.
  return useMemo(() => {
    if (!pending) {
      return {
        isRecovering: false,
        willAutoRecover,
        message: null,
        attempt: 0,
        attempts: errorKind ? langyRecoveryPolicy(errorKind).attempts : 0,
        reset,
      };
    }

    const policy = langyRecoveryPolicy(pending.kind);
    return {
      isRecovering: true,
      willAutoRecover,
      message: policy.recoveringMessage,
      attempt: pending.attempt,
      attempts: policy.attempts,
      reset,
    };
  }, [pending, willAutoRecover, errorKind, reset]);
}
