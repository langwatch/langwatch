/**
 * A few slots handed out in the order rows ask: the list asks for every visible row's runs, and
 * only `limit` of those calls are in flight at once. A row gives its slot back when its call ends.
 */
export type RunSlotQueue = {
  request: (id: string) => void;
  release: (id: string) => void;
  granted: (id: string) => boolean;
  subscribe: (listener: () => void) => () => void;
};

export function createRunSlotQueue(limit: number): RunSlotQueue {
  const active = new Set<string>();
  const waiting: string[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const promote = () => {
    while (active.size < limit && waiting.length > 0) active.add(waiting.shift()!);
  };
  return {
    request: (id) => {
      if (active.has(id) || waiting.includes(id)) return;
      waiting.push(id);
      promote();
      notify();
    },
    release: (id) => {
      const queued = waiting.indexOf(id);
      if (queued >= 0) waiting.splice(queued, 1);
      const wasActive = active.delete(id);
      if (!wasActive && queued < 0) return;
      promote();
      notify();
    },
    granted: (id) => active.has(id),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** How many rows' runs the list asks for at the same time. */
export const RUNS_IN_FLIGHT = 4;
