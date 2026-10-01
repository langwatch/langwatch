/**
 * The wall-clock timer that ends a voice call at VOICE_CALL_MAX_SECONDS. On
 * elapse the child disconnects gracefully, judged on what was said and
 * marked cut (AC28). Injectable, so fire-once/clear are unit-tested without real time.
 */

export interface CallLimitTimer {
  /** True once the limit has elapsed and `onLimit` has fired. */
  wasCut(): boolean;
  /** Stop the timer; a call that finished on its own never fires `onLimit`. */
  clear(): void;
}

type TimerHandle = NodeJS.Timeout;

export function createCallLimitTimer({
  maxCallSeconds,
  onLimit,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  maxCallSeconds: number;
  onLimit: () => void;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}): CallLimitTimer {
  let cut = false;
  const handle = setTimer(() => {
    // Fire exactly once: a duplicate timer event must not re-end the call.
    if (cut) return;
    cut = true;
    onLimit();
  }, maxCallSeconds * 1000);

  return {
    wasCut: () => cut,
    clear: () => clearTimer(handle),
  };
}
