import { afterAll, vi } from "vitest";

/**
 * Isolation is off by default, so files share a worker: fake timers a file leaves on would
 * stall every real `setTimeout` in the next file until its tests time out. A `setupFiles` entry.
 */
afterAll(() => {
  vi.useRealTimers();
});
