/**
 * Bounds how many widget queries one page has in flight. A dashboard's widgets
 * all ask at once on load and on every refresh; the rest wait their turn here
 * instead of arriving together at the query service's concurrency ceiling.
 */

/** Widget queries one page runs at a time, across every frame on it. */
export const PAGE_WIDGET_QUERY_CONCURRENCY = 4;

export interface WidgetQueryLane {
  /** Runs `task` when a slot is free. An abort while waiting rejects without running it. */
  run<Result>(args: { task: () => Promise<Result>; signal: AbortSignal }): Promise<Result>;
}

export function createWidgetQueryLane({ limit }: { limit: number }): WidgetQueryLane {
  let running = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    running -= 1;
    waiting.shift()?.();
  };

  const acquire = (signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (running < limit) {
        running += 1;
        resolve();
        return;
      }
      const onAbort = (): void => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(signal.reason);
      };
      const start = (): void => {
        signal.removeEventListener("abort", onAbort);
        running += 1;
        resolve();
      };
      waiting.push(start);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  return {
    async run({ task, signal }) {
      signal.throwIfAborted();
      await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

/** The one lane every chart frame on the page shares. */
export const pageWidgetQueryLane: WidgetQueryLane = createWidgetQueryLane({
  limit: PAGE_WIDGET_QUERY_CONCURRENCY,
});
