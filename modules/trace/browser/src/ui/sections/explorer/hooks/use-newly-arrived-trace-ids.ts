import { nowInstant } from "@langwatch/time";
import { useEffect, useRef, useState } from "react";

import type { TraceListItem } from "../types/trace.ts";

const NEW_ID_TTL_MS = 3500;
/** Cap the seen-ids memory in long sessions — old entries get evicted FIFO. */
const SEEN_IDS_CAP = 5_000;

function collectFreshTraceIds({
  traces,
  seen,
  mountedAt,
}: {
  traces: TraceListItem[];
  seen: Map<string, true>;
  mountedAt: number;
}): string[] {
  const fresh: string[] = [];
  for (const trace of traces) {
    if (seen.has(trace.traceId)) continue;
    seen.set(trace.traceId, true);
    if (seen.size > SEEN_IDS_CAP) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    if (trace.timestamp > mountedAt) fresh.push(trace.traceId);
  }
  return fresh;
}

function withFreshIds(current: Set<string>, fresh: string[]): Set<string> {
  const next = new Set(current);
  for (const id of fresh) next.add(id);
  return next;
}

function withoutId(current: Set<string>, id: string): Set<string> {
  if (!current.has(id)) return current;
  const next = new Set(current);
  next.delete(id);
  return next;
}

/**
 * Track which trace IDs are "new": arrived since this hook mounted AND started after
 * mount time. The timestamp gate keeps filter / page / sort changes from making every
 * backfilled trace pulse. Each new id self-evicts after `NEW_ID_TTL_MS`.
 */
export function useNewlyArrivedTraceIds(traces: TraceListItem[]): Set<string> {
  const mountedAtRef = useRef(nowInstant().epochMilliseconds);
  // Insertion-ordered Map used as a bounded FIFO set.
  const seenIdsRef = useRef<Map<string, true>>(new Map());
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const fresh = collectFreshTraceIds({
      traces,
      seen: seenIdsRef.current,
      mountedAt: mountedAtRef.current,
    });
    if (fresh.length === 0) return;

    setNewIds((current) => withFreshIds(current, fresh));

    for (const id of fresh) {
      const existing = expiryTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        expiryTimersRef.current.delete(id);
        setNewIds((current) => withoutId(current, id));
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
