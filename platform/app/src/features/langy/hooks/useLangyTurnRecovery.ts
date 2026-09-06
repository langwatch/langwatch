import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * Derived SYNCHRONOUSLY during render (not from the timer effect): will this
   * failure auto-retry? The caller gates the red error card on `!willAutoRecover`
   * so the card never renders for even a single frame before the effect arms the
   * timer — the flash that made a recovering turn look failed. `isRecovering`
   * tracks the same condition, so today they move together; the field is named
   * for the guard's intent so the panel reads as "don't show the card if we're
   * about to retry".
   */
  willAutoRecover: boolean;
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
   *
   * NOT the whole identity on its own — see `handledFailureRef`. The same Error
   * object can be RECLASSIFIED, so what the hook has already handled is the
   * pair (kind, id).
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
   * The failure this hook has already acted on, as the PAIR (kind, id) — never
   * the id alone.
   *
   * A failure's kind is not fixed at the moment its Error is minted. The panel
   * derives the kind through `resolveLiveTurnError`, whose last road reads the
   * turn's classification off the DURABLE record — which arrives on the history
   * poll, seconds after the stream died. So one and the same Error object is
   * first explained as `unknown` and then, when the poll lands, as
   * `langy_worker_restarting`: the kind moves under a stable identity.
   *
   * Keyed on the id alone, the short-circuit below swallowed that: the second
   * pass returned early, so a failure the policy would have auto-recovered was
   * never armed at all (and, the other way round, a timer armed for the first
   * kind would have fired on the first kind's budget). Two fields rather than a
   * `${kind}:${id}` composite on purpose — stringifying the id would collapse
   * two distinct Errors carrying the same message into one identity.
   */
  const handledFailureRef = useRef<{ kind: string; id: unknown } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;
  // The one input that arrives LATE by construction, so it is read TWICE and is
  // deliberately kept out of the effect's dep array.
  //
  // The caller derives it from the engine's messages (`turnHadSideEffects`), and
  // those are replaced wholesale whenever the 3s `langy.messages` poll lands —
  // well inside this hook's 1500/4000ms waits. As a dep it therefore re-ran the
  // effect mid-wait for the SAME failure, and the re-run could only make things
  // worse: the effect's own short-circuit treats an already-handled (kind, id)
  // as nothing to do, so with a cleanup attached the re-render killed the armed
  // timer and re-armed nothing. Read off a ref, a mid-flight history poll cannot
  // disturb a retry that is already scheduled.
  //
  // The arming-time read is therefore NOT the safety check — it cannot be. When
  // the timer arms, the evidence that this turn already mutated the project may
  // still be in flight, and `canAutoRecover` opens with `sideEffectsObserved`
  // for a reason: re-driving a turn that opened a PR can open a second one. So
  // the ref is read again inside the timer callback, immediately before the
  // retry fires, and a turn revealed as mutating in the meantime falls through
  // to the error card exactly as an arming-time rejection would. Arming is the
  // early exit; the callback is the invariant.
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
      // LAST-MOMENT SAFETY RE-READ. Everything else the policy weighs was
      // settled when the timer armed; this one was not. The evidence that the
      // dead turn already ran a project-mutating tool rides in on the history
      // poll, which lands INSIDE this wait, so a turn that looked inert at
      // arming time can be known to have opened a PR by the time the timer
      // fires. Re-driving it then is the exact thing `canAutoRecover`'s
      // `sideEffectsObserved` guard exists to prevent — a second PR, a second
      // prompt — so abandon the retry and hand the decision to the user via the
      // card, the same landing as an arming-time rejection. No attempt is
      // charged, because none was made.
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

  // SYNCHRONOUS: will THIS failure be handled by an automatic retry? Decided from
  // the same inputs the effect uses but WITHOUT waiting for it to run. `isRecovering`
  // (below) is timer-driven — true only once the effect has ARMED the retry — so on
  // the first paint of a fresh auto-retryable failure it is still false, and a panel
  // that gated the red card on `!isRecovering` alone flashed it for that one frame.
  // `willAutoRecover` is true from the very first paint, so the panel gates the card
  // on `!willAutoRecover` and it never renders while a retry is coming. (They differ
  // only in that brief pre-arm window and after a retry fires — never show the card
  // in either; that is the whole point.)
  const willAutoRecover =
    !!errorKind &&
    enabled &&
    canAutoRecover({
      kind: errorKind,
      attemptsUsed: attemptsUsedRef.current,
      sideEffectsObserved,
    });

  // MEMOISED so the handle is as stable as the state behind it.
  //
  // This is now belt-and-braces rather than load-bearing, and the history is
  // the reason it stays. The panel used to thread this object into
  // `useCallback` deps (the choices card's `onChoiceSelect`), so a fresh object
  // literal per render minted a fresh callback per render — a changed prop on
  // every `memo(MessageContent)` in the column, and a streaming turn re-rendered
  // every message in the conversation on every token. That callback has since
  // moved to an implementation-ref, so today nothing reads this identity; the
  // panel only reads properties off it.
  //
  // A hook that hands out an OBJECT owes callers a stable one anyway: the
  // caller cannot see the difference until it costs them a render storm, and
  // this panel has already paid that bill once. Dropping the memo would make
  // the next `[recovery]` dep array — or the next time it is passed to a memo'd
  // child — a silent regression instead of a non-event.
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
