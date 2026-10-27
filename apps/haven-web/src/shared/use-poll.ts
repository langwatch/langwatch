import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { nowMs } from "./clock.ts";

export type Poll<T> = {
  data: T | undefined;
  /** The last poll's failure; cleared by the next success. */
  error: string | undefined;
  /** Epoch milliseconds of the last success. */
  updatedAt: number | undefined;
  /** Polls now, outside the interval: after an action, or on demand. */
  refresh: () => Promise<void>;
};

type PollState<T> = Pick<Poll<T>, "data" | "error" | "updatedAt">;

const describe = ({ error }: { error: unknown }) =>
  error instanceof Error ? error.message : String(error);

/** One read: success replaces the state, a failure keeps the data and says why. */
const readOnce = async <T>({
  load,
  signal,
  isCurrent,
  setState,
}: {
  load: (input: { signal: AbortSignal }) => Promise<T>;
  signal: AbortSignal;
  isCurrent: () => boolean;
  setState: Dispatch<SetStateAction<PollState<T>>>;
}) => {
  try {
    const data = await load({ signal });
    if (isCurrent()) setState({ data, error: undefined, updatedAt: nowMs() });
  } catch (error) {
    if (isCurrent() && !signal.aborted) {
      setState((previous) => ({ ...previous, error: describe({ error }) }));
    }
  }
};

/**
 * Reads `load` now and every `intervalMs` while the page is visible, one read
 * in flight at a time. A new `key` drops what the old one loaded.
 */
export const usePoll = <T>({
  key,
  load,
  intervalMs,
  paused = false,
}: {
  key: string;
  load: (input: { signal: AbortSignal }) => Promise<T>;
  intervalMs: number;
  paused?: boolean;
}): Poll<T> => {
  const [state, setState] = useState<PollState<T>>({
    data: undefined,
    error: undefined,
    updatedAt: undefined,
  });
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });
  const inFlight = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    const mine = generation.current;
    inFlight.current = controller;
    await readOnce({
      load: loadRef.current,
      signal: controller.signal,
      isCurrent: () => mine === generation.current,
      setState,
    });
    if (inFlight.current === controller) inFlight.current = undefined;
  }, []);

  useEffect(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = undefined;
    setState({ data: undefined, error: undefined, updatedAt: undefined });
  }, [key]);

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState !== "hidden") void run();
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [key, paused, intervalMs, run]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { ...state, refresh: run };
};
