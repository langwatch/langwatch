import { nowInstant } from "@langwatch/time";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useSSESubscription } from "@langwatch/trace-web/surfaces/sse-subscription";
import {
  type LangyConversationUpdateSignal,
  langyConversationUpdateSignalSchema,
} from "@langwatch/langy-contract";
import { api } from "../../../behavior/langy-api.ts";

interface DebounceRefs {
  debounceTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  maxWaitTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  pendingRef: RefObject<Map<string, LangyConversationUpdateSignal>>;
  onUpdatedRef: RefObject<
    ((signals: LangyConversationUpdateSignal[]) => void | Promise<void>) | undefined
  >;
}

function flushPending(refs: DebounceRefs): void {
  if (refs.debounceTimerRef.current) {
    clearTimeout(refs.debounceTimerRef.current);
    refs.debounceTimerRef.current = null;
  }
  if (refs.maxWaitTimerRef.current) {
    clearTimeout(refs.maxWaitTimerRef.current);
    refs.maxWaitTimerRef.current = null;
  }
  const signals = [...refs.pendingRef.current.values()];
  refs.pendingRef.current = new Map();
  if (signals.length > 0) {
    void refs.onUpdatedRef.current?.(signals);
  }
}

function scheduleSignal(
  refs: DebounceRefs,
  signal: LangyConversationUpdateSignal,
  flush: () => void,
  debounceMs: number,
  maxWaitMs: number | undefined,
): void {
  refs.pendingRef.current.set(signal.conversationId, signal);
  if (refs.debounceTimerRef.current) clearTimeout(refs.debounceTimerRef.current);
  refs.debounceTimerRef.current = setTimeout(flush, debounceMs);
  if (maxWaitMs != null && !refs.maxWaitTimerRef.current) {
    refs.maxWaitTimerRef.current = setTimeout(flush, maxWaitMs);
  }
}

/** Parses the SSE payload into a signal, or null for anything not worth scheduling. */
function parseConversationUpdateSignal(data: {
  event: string;
}): LangyConversationUpdateSignal | null {
  if (!data.event) return null;
  try {
    const raw = typeof data.event === "string" ? JSON.parse(data.event) : data.event;
    const parsed = langyConversationUpdateSignalSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    // Non-JSON payload — ignore.
    return null;
  }
}

interface UseLangyConversationUpdateListenerOptions {
  projectId: string;
  enabled?: boolean;
  /**
   * Fires with the accumulated per-conversation signals after a quiet window.
   * Last-write-wins per conversation id: only the freshest operational spine
   * for each conversation is delivered.
   */
  onConversationUpdated?: (signals: LangyConversationUpdateSignal[]) => void | Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
}

/**
 * Subscribes to the per-conversation freshness SSE (`langy.onConversationUpdate`) and
 * coalesces signals into a debounced callback.
 */
export function useLangyConversationUpdateListener({
  projectId,
  enabled = true,
  onConversationUpdated,
  debounceMs = 1500,
  maxWaitMs = 1500,
}: UseLangyConversationUpdateListenerOptions) {
  const onUpdatedRef = useRef(onConversationUpdated);
  onUpdatedRef.current = onConversationUpdated;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keyed by conversation id so repeated updates collapse to the freshest.
  const pendingRef = useRef<Map<string, LangyConversationUpdateSignal>>(new Map());

  // A stable bundle of the refs above — built once, so `flush`/`schedule`
  // keep the same identity across renders exactly as they did before.
  const refsRef = useRef<DebounceRefs | null>(null);
  refsRef.current ??= { debounceTimerRef, maxWaitTimerRef, pendingRef, onUpdatedRef };
  const refs = refsRef.current;

  const flush = useCallback(() => flushPending(refs), [refs]);

  const schedule = useCallback(
    (signal: LangyConversationUpdateSignal) =>
      scheduleSignal(refs, signal, flush, debounceMs, maxWaitMs),
    [refs, flush, debounceMs, maxWaitMs],
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    };
  }, []);

  const [lastEventAt, setLastEventAt] = useState(0);

  const sse = useSSESubscription<{ event: string; timestamp: number }, { projectId: string }>(
    api.langy.onConversationUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        const signal = parseConversationUpdateSignal(data);
        if (!signal) return;
        setLastEventAt(nowInstant().epochMilliseconds);
        schedule(signal);
      },
    },
  );

  return { connectionState: sse.connectionState, lastEventAt };
}
