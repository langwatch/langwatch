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

/** Follows while the tab is shown, or always when `inBackground`; reads at once when shown. */
const followWhileShown = ({
  refresh,
  inBackground,
}: {
  refresh: () => Promise<Summary[] | undefined>;
  inBackground: boolean;
}) => {
  let running: AbortController | undefined;
  const sync = () => {
    const shown = inBackground || document.visibilityState !== "hidden";
    if (shown && running === undefined) {
      running = new AbortController();
      void follow({ refresh, signal: running.signal });
    } else if (!shown && running !== undefined) {
      running.abort();
      running = undefined;
    }
  };
  sync();
  document.addEventListener("visibilitychange", sync);
  return () => {
    document.removeEventListener("visibilitychange", sync);
    running?.abort();
  };
};

/**
 * The caught messages, newest first, kept live: read the list, park on /api/messages/wait,
 * read again when mail lands or the wait lapses (so CLI deletions show). A hidden tab stops
 * asking unless `inBackground` (desktop notifications on) keeps it following.
 */
export const useLiveInbox = ({
  onList,
  inBackground = false,
}: {
  onList: (input: { messages: Summary[] }) => void;
  inBackground?: boolean;
}) => {
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

  useEffect(() => followWhileShown({ refresh, inBackground }), [refresh, inBackground]);

  return { messages, connection, error, refresh };
};
