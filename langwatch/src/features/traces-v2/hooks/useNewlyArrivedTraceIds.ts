import { useEffect, useRef, useState } from "react";
import type { TraceListItem } from "../types/trace";

const NEW_ID_TTL_MS = 3500;
/** Cap the seen-ids memory in long sessions — old entries get evicted FIFO. */
const SEEN_IDS_CAP = 5_000;

/**
 * Track which trace IDs are "new": arrived since this hook mounted AND started
 * after mount time. The timestamp gate keeps filter / page / sort changes from
 * making every backfilled trace pulse. Each new id self-evicts after
 * `NEW_ID_TTL_MS`. The seen-ids set is bounded so a long-running tab doesn't
 * grow it without limit.
 */
export function useNewlyArrivedTraceIds(
  traces: TraceListItem[],
): Set<string> {
  const mountedAtRef = useRef(Date.now());
  // Insertion-ordered Map used as a bounded FIFO set.
  const seenIdsRef = useRef<Map<string, true>>(new Map());
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const seen = seenIdsRef.current;
    const fresh: string[] = [];
    for (const trace of traces) {
      if (seen.has(trace.traceId)) continue;
      seen.set(trace.traceId, true);
      if (seen.size > SEEN_IDS_CAP) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      if (trace.timestamp > mountedAtRef.current) fresh.push(trace.traceId);
    }
    if (fresh.length === 0) return;

    setNewIds((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });

    for (const id of fresh) {
      const existing = expiryTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        expiryTimersRef.current.delete(id);
        setNewIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, NEW_ID_TTL_MS);
      expiryTimersRef.current.set(id, timer);
    }
  }, [traces]);

  useEffect(() => {
    const timers = expiryTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return newIds;
}
