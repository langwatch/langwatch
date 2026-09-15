/**
 * The wall-clock timer that ends a voice call at VOICE_CALL_MAX_SECONDS.
 *
 * When the limit elapses the call is ended gracefully (the child disconnects the
 * transport) so the judge still runs on what was said, and the run is marked as
 * cut at the limit (AC28). Kept as a tiny injectable helper so the fire-once and
 * clear semantics are unit-tested without real time.
 */

export interface CallLimitTimer {
  /** True once the limit has elapsed and `onLimit` has fired. */
  wasCut(): boolean;
  /** Stop the timer; a call that finished on its own never fires `onLimit`. */
  clear(): void;
}

export function createCallLimitTimer({
  maxCallSeconds,
  onLimit,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  maxCallSeconds: number;
  onLimit: () => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
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
