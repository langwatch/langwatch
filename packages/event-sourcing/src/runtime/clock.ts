import type { Clock } from "./contracts";

/**
 * The wall clock, for every deployment that is not a test.
 *
 * `memoryClock` is the only other implementation and it starts frozen at 0, so
 * a composition root that reaches for it by mistake arms every wake deadline in
 * 1970 and reads every lease as already expired.
 */
export function systemClock(): Clock {
  return { now: () => Date.now() };
}
