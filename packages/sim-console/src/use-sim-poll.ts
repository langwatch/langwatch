import { useCallback, useEffect, useRef, useState } from "react";

type Answer<T> = { data?: T; error?: Error };

const failed = <T>({ caught }: { caught: unknown }) => {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  return (previous: Answer<T>): Answer<T> => ({ data: previous.data, error });
};

/**
 * Calls `fetch` now and every `everyMs` while the tab is visible, and again the
 * moment it is shown. `fetch` is read afresh on each call, so an inline arrow is
 * fine; call `refresh` after changing what it reads to see the change at once.
 */
export const useSimPoll = <T>({
  fetch,
  everyMs = 2_000,
}: {
  fetch: () => Promise<T>;
  everyMs?: number;
}) => {
  const [answer, setAnswer] = useState<Answer<T>>({});
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(fetch);
  latest.current = fetch;
  // Only the newest call may answer, so a slow stale one never overwrites it.
  const newest = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    newest.current += 1;
    const call = newest.current;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const data = await latest.current();
      if (call === newest.current) setAnswer({ data });
    } catch (caught) {
      if (call === newest.current) setAnswer(failed<T>({ caught }));
    } finally {
      if (call === newest.current) {
        inFlight.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const follow = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      void refresh();
      timer = setInterval(() => {
        if (!inFlight.current) void refresh();
      }, everyMs);
    };
    follow();
    document.addEventListener("visibilitychange", follow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", follow);
      newest.current += 1;
    };
  }, [refresh, everyMs]);

  return { data: answer.data, error: answer.error, refreshing, refresh };
};
