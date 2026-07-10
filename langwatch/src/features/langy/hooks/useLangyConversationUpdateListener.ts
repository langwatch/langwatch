import { useCallback, useEffect, useRef, useState } from "react";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import { api } from "~/utils/api";
import {
  langyConversationUpdateSignalSchema,
  type LangyConversationUpdateSignal,
} from "~/server/api/routers/langy.schemas";

interface UseLangyConversationUpdateListenerOptions {
  projectId: string;
  enabled?: boolean;
  /**
   * Fires with the accumulated per-conversation signals after a quiet window.
   * Last-write-wins per conversation id: only the freshest operational spine
   * for each conversation is delivered.
   */
  onConversationUpdated?: (
    signals: LangyConversationUpdateSignal[],
  ) => void | Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
}

/**
 * Subscribes to the per-conversation freshness SSE (`langy.onConversationUpdate`)
 * and coalesces signals into a debounced callback. Mirrors
 * `useTraceUpdateListener`: trailing-edge debounce with a `maxWait` cap so a
 * steady stream of updates still flushes during active turns.
 *
 * The signal carries a lightweight operational payload (status/counts/activity),
 * NOT message content — see `langyConversationUpdateSignalSchema`. The
 * coordinator uses that payload to apply updates in place and skip a refetch.
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
  const pendingRef = useRef<Map<string, LangyConversationUpdateSignal>>(
    new Map(),
  );

  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    const signals = [...pendingRef.current.values()];
    pendingRef.current = new Map();
    if (signals.length > 0) {
      void onUpdatedRef.current?.(signals);
    }
  }, []);

  const schedule = useCallback(
    (signal: LangyConversationUpdateSignal) => {
      pendingRef.current.set(signal.conversationId, signal);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(flush, debounceMs);
      if (maxWaitMs != null && !maxWaitTimerRef.current) {
        maxWaitTimerRef.current = setTimeout(flush, maxWaitMs);
      }
    },
    [debounceMs, maxWaitMs, flush],
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    };
  }, []);

  const [lastEventAt, setLastEventAt] = useState(0);

  const sse = useSSESubscription<
    { event: string; timestamp: number },
    { projectId: string }
  >(
    // @ts-expect-error - tRPC subscription type isn't inferred for the hook's generic
    api.langy.onConversationUpdate,
    { projectId },
    {
      enabled: Boolean(enabled && projectId),
      onData: (data) => {
        if (!data.event) return;
        try {
          const raw =
            typeof data.event === "string" ? JSON.parse(data.event) : data.event;
          const parsed = langyConversationUpdateSignalSchema.safeParse(raw);
          if (!parsed.success) return;
          setLastEventAt(Date.now());
          schedule(parsed.data);
        } catch {
          // Non-JSON payload — ignore.
        }
      },
    },
  );

  return { connectionState: sse.connectionState, lastEventAt };
}
