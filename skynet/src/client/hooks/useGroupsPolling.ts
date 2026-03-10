import { useState, useEffect, useRef, useCallback } from "react";
import type { QueueInfo } from "../../shared/types.ts";
import { GROUPS_POLL_INTERVAL_MS } from "../../shared/constants.ts";
import { apiFetch } from "./useApi.ts";

/**
 * Polls /api/groups for full queue data (including individual groups).
 * Groups are no longer included in SSE broadcasts to avoid serializing
 * potentially millions of GroupInfo objects every 2 seconds.
 */
export function useGroupsPolling(pausedRef: React.RefObject<boolean>): {
  queues: QueueInfo[];
  flush: () => void;
} {
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const buffered = useRef<QueueInfo[] | null>(null);

  const flush = useCallback(() => {
    if (buffered.current) {
      setQueues(buffered.current);
      buffered.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const fetchGroups = async () => {
      try {
        const data = await apiFetch<{ queues: QueueInfo[] }>("/api/groups");
        if (!active) return;

        if (pausedRef.current) {
          buffered.current = data.queues;
        } else {
          buffered.current = null;
          setQueues(data.queues);
        }
      } catch {
        // ignore fetch errors — will retry on next interval
      }
    };

    fetchGroups();
    const interval = setInterval(fetchGroups, GROUPS_POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pausedRef]);

  return { queues, flush };
}
