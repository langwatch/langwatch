import { useCallback, useEffect, useRef, useState } from "react";

import { mailApi, type Summary } from "./mail-api.ts";

const RETRY_MS = 2_000;

export type Connection = "starting" | "live" | "down";

const pause = ({ ms, signal }: { ms: number; signal: AbortSignal }) =>
  new Promise<void>((settle) => {
    const timer = setTimeout(settle, ms);
    signal.addEventListener("abort", () => clearTimeout(timer));
  });

/** Reads the list, then parks until newer mail lands or the wait lapses, until stopped. */
const follow = async ({
  refresh,
  signal,
}: {
  refresh: () => Promise<Summary[] | undefined>;
  signal: AbortSignal;
}) => {
  while (!signal.aborted) {
    const listed = await refresh();
    if (signal.aborted) return;
    if (listed === undefined) {
      await pause({ ms: RETRY_MS, signal });
      continue;
    }
    try {
      await mailApi.waitForArrival({ after: listed[0]?.id ?? "", signal });
    } catch {
      await pause({ ms: RETRY_MS, signal });
    }
  }
};

/**
 * The caught messages, newest first, kept live: read the list, then park on
 * /api/messages/wait for anything newer and read it again when mail lands or
 * the wait lapses (so deletions from the CLI show too).
 */
export const useLiveInbox = ({ onList }: { onList: (input: { messages: Summary[] }) => void }) => {
  const [messages, setMessages] = useState<Summary[] | undefined>(undefined);
  const [connection, setConnection] = useState<Connection>("starting");
  const [error, setError] = useState<string | undefined>(undefined);
  const onListRef = useRef(onList);
  onListRef.current = onList;

  const refresh = useCallback(async () => {
    try {
      const next = await mailApi.list();
      setMessages(next);
      setConnection("live");
      setError(undefined);
      onListRef.current({ messages: next });
      return next;
    } catch (caught) {
      setConnection("down");
      setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    }
  }, []);

  useEffect(() => {
    const stop = new AbortController();
    void follow({ refresh, signal: stop.signal });
    return () => stop.abort();
  }, [refresh]);

  return { messages, connection, error, refresh };
};
