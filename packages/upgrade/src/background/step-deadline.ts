/** A blocking step past this fails by name, for a Retry on Ops > Upgrades (2026-10-10). */
export const BLOCKING_STEP_DEADLINE_MS = 30 * 60_000;

/** The step's own signal, the race that stops awaiting it, and the timer's stop. */
export interface StepDeadline {
  signal: AbortSignal;
  race: <Result>(run: Promise<Result>) => Promise<Result>;
  stop: () => void;
}

/**
 * A step run's deadline: past `deadlineMs` its signal aborts with an error naming the deadline and
 * `race` stops awaiting the run, so a step that ignores its signal cannot hold the run forever.
 */
export function stepDeadline({
  signal,
  deadlineMs,
  reason,
}: {
  signal: AbortSignal;
  deadlineMs: number;
  reason: string;
}): StepDeadline {
  const controller = new AbortController();
  const onStop = () => controller.abort(signal.reason);
  if (signal.aborted) onStop();
  else signal.addEventListener("abort", onStop, { once: true });
  let expire: (error: Error) => void = () => undefined;
  const expired = new Promise<never>((_, reject) => (expire = reject));
  expired.catch(() => undefined);
  const timer = setTimeout(() => {
    const error = new Error(reason);
    controller.abort(error);
    expire(error);
  }, deadlineMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    race: (run) => Promise.race([run, expired]),
    stop: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onStop);
    },
  };
}
